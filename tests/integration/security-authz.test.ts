/**
 * Authorization sweep through the real route handlers (session cookie -> requireUser -> RBAC -> domain).
 *
 * Two courses: CSE 115 (instructor A, students S1/S2) and CSE 116 (instructor B, student S3). Every test guesses a
 * real id from the other course or another student and expects a denial (401/403/404) and no leaked content.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers read the session cookie through next/headers; drive it from the test.
let currentToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "socra_session" && currentToken ? { name, value: currentToken } : undefined,
    set: () => undefined,
  }),
  headers: async () => new Headers(),
}));

import { loadPrincipal } from "@/server/auth/current-user";
import { createSession } from "@/server/auth/session";
import { disconnectPrisma, prisma } from "@/server/db";
import { env } from "@/server/env";
import { clientIp } from "@/server/http";
import {
  createAssignment,
  getAssignmentForEdit,
  publishAssignment,
} from "@/server/domain/assignments/service";
import { createSubmission } from "@/server/domain/submissions/service";
import { saveDraft } from "@/server/domain/workspace/drafts";

import * as assignmentRoute from "@/app/api/assignments/[id]/route";
import * as publishRoute from "@/app/api/assignments/[id]/publish/route";
import * as closeRoute from "@/app/api/assignments/[id]/close/route";
import * as releaseRoute from "@/app/api/assignments/[id]/release-solutions/route";
import * as gradingListRoute from "@/app/api/grading/assignments/[id]/submissions/route";
import * as finalizeRoute from "@/app/api/grading/submissions/[id]/finalize/route";
import * as aiSuggestionRoute from "@/app/api/grading/submissions/[id]/ai-suggestion/route";
import * as analyticsAssignmentRoute from "@/app/api/analytics/assignments/[assignmentId]/route";
import * as analyticsOverviewRoute from "@/app/api/analytics/courses/[courseId]/overview/route";
import * as analyticsQuestionRoute from "@/app/api/analytics/questions/[questionId]/route";
import * as resourceRoute from "@/app/api/resources/[id]/route";
import * as resourcesRoute from "@/app/api/resources/route";
import * as draftsRoute from "@/app/api/drafts/route";
import * as runsRoute from "@/app/api/runs/route";
import * as socraSessionRoute from "@/app/api/socra/sessions/[id]/route";
import * as socraSessionsRoute from "@/app/api/socra/sessions/route";
import * as socraMessagesRoute from "@/app/api/socra/sessions/[id]/messages/route";
import * as transcriptRoute from "@/app/api/socra/transcripts/[sessionId]/route";
import * as practiceNextRoute from "@/app/api/practice/sessions/[id]/next/route";
import * as learnerProfileRoute from "@/app/api/learner/profile/route";
import * as grantsRoute from "@/app/api/admin/grants/route";

const RUN = randomUUID().slice(0, 8);
const C115 = `itest_sec_115_${RUN}`;
const C116 = `itest_sec_116_${RUN}`;
const HIDDEN_NAME = `sec-hidden-${RUN}`;
const REF_SOLUTION = `def total(xs): return sum(xs)  # sec-ref ${RUN}`;
const CHAT_SECRET = `private chat ${RUN}`;
const DRAFT_SECRET = `draft secret ${RUN}`;

const ids = {
  instA: "",
  instB: "",
  stu1: "",
  stu2: "",
  stu3: "",
  admin: "",
  admin2: "",
  research: "",
};
const tokens: Record<keyof typeof ids, string> = { ...ids };
let a115 = "";
let q115 = "";
let a116 = "";
let q116 = "";
let sub116 = "";
let res116 = "";
let socraStu1 = "";
let practiceStu1 = "";

const ORIGIN = () => new URL(env().APP_URL).origin;

function as(who: keyof typeof ids | null) {
  currentToken = who ? tokens[who] : undefined;
}

function req(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (method !== "GET" && !("origin" in headers)) headers.origin = ORIGIN();
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN()}${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = <K extends string>(key: K, value: string) => ({
  params: Promise.resolve({ [key]: value } as Record<K, string>),
});

async function bodyText(res: Response): Promise<string> {
  return res.text();
}

async function makeUser(
  key: keyof typeof ids,
  roles: ("STUDENT" | "INSTRUCTOR" | "SYSTEM_ADMIN" | "RESEARCH_ADMIN")[],
  membership?: { courseId: string; role: "STUDENT" | "INSTRUCTOR" },
) {
  const u = await prisma.user.create({
    data: {
      email: `${key}-${RUN}@sec.socra.local`,
      name: key,
      roles,
      ...(membership ? { memberships: { create: membership } } : {}),
    },
  });
  ids[key] = u.id;
  tokens[key] = (await createSession(u.id, { userAgent: "vitest-security" })).token;
}

function assignmentInput(courseId: string, title: string) {
  return {
    courseId,
    title,
    description: "Add numbers.",
    format: "CODING",
    language: "PYTHON",
    solutionReleaseMode: "MANUAL",
    questions: [
      {
        title: "total",
        prompt: "Write total(xs).",
        type: "CODING",
        points: 10,
        entryPoint: "total",
        starterCode: "def total(xs):\n    pass\n",
        referenceSolution: REF_SOLUTION,
        tests: [
          { name: "pass public", visibility: "PUBLIC", weight: 1, args: [[1, 2]], expectedReturn: 3 },
          { name: HIDDEN_NAME, visibility: "HIDDEN", weight: 3, args: [[]], expectedReturn: 0 },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  for (const [id, code] of [
    [C115, "CSE 115"],
    [C116, "CSE 116"],
  ] as const) {
    await prisma.course.create({
      data: { id, code, title: code, term: "T", languages: ["PYTHON"] },
    });
  }
  await makeUser("instA", ["INSTRUCTOR"], { courseId: C115, role: "INSTRUCTOR" });
  await makeUser("instB", ["INSTRUCTOR"], { courseId: C116, role: "INSTRUCTOR" });
  await makeUser("stu1", ["STUDENT"], { courseId: C115, role: "STUDENT" });
  await makeUser("stu2", ["STUDENT"], { courseId: C115, role: "STUDENT" });
  await makeUser("stu3", ["STUDENT"], { courseId: C116, role: "STUDENT" });
  await makeUser("admin", ["SYSTEM_ADMIN"]);
  await makeUser("admin2", ["SYSTEM_ADMIN"]);
  await makeUser("research", ["RESEARCH_ADMIN"]);

  const instA = (await loadPrincipal(ids.instA))!;
  const instB = (await loadPrincipal(ids.instB))!;
  const stu1 = (await loadPrincipal(ids.stu1))!;
  const stu3 = (await loadPrincipal(ids.stu3))!;

  a115 = (await createAssignment(instA, assignmentInput(C115, `A115 ${RUN}`))).id;
  a116 = (await createAssignment(instB, assignmentInput(C116, `A116 ${RUN}`))).id;
  await publishAssignment(instA, a115);
  await publishAssignment(instB, a116);
  q115 = (await getAssignmentForEdit(instA, a115)).input.questions[0]!.id!;
  q116 = (await getAssignmentForEdit(instB, a116)).input.questions[0]!.id!;

  await saveDraft(stu1, {
    assignmentId: a115,
    questionId: q115,
    content: DRAFT_SECRET,
    baseVersion: 0,
  });
  sub116 = (
    await createSubmission(stu3, {
      assignmentId: a116,
      idempotencyKey: `sec-${RUN}-stu3`,
      answers: [{ questionId: q116, content: "def total(xs): return 0" }],
    })
  ).submissionId;
  res116 = (
    await prisma.courseResource.create({
      data: { courseId: C116, title: `Notes ${RUN}`, type: "LECTURE_NOTES" },
    })
  ).id;
  socraStu1 = (
    await prisma.aiSession.create({
      data: {
        userId: ids.stu1,
        courseId: C115,
        mode: "PROTECTED_ASSESSMENT",
        assignmentId: a115,
        questionId: q115,
        messages: { create: [{ role: "USER", content: CHAT_SECRET }] },
      },
    })
  ).id;
  practiceStu1 = (
    await prisma.practiceSession.create({ data: { userId: ids.stu1, courseId: C115 } })
  ).id;
});

afterAll(async () => {
  currentToken = undefined;
  await disconnectPrisma();
});

describe("authentication", () => {
  it("rejects requests without a session (401)", async () => {
    as(null);
    const res = await assignmentRoute.GET(req(`/api/assignments/${a115}`), ctx("id", a115));
    expect(res.status).toBe(401);
    const drafts = await draftsRoute.GET(
      req(`/api/drafts?assignmentId=${a115}&questionId=${q115}`),
      undefined,
    );
    expect(drafts.status).toBe(401);
  });
});

describe("cross-course IDOR (CSE 115 instructor vs CSE 116)", () => {
  it("cannot read another course's assignment (with hidden tests) for editing", async () => {
    as("instA");
    const res = await assignmentRoute.GET(req(`/api/assignments/${a116}`), ctx("id", a116));
    expect(res.status).toBe(403);
    const text = await bodyText(res);
    expect(text).not.toContain(HIDDEN_NAME);
    expect(text).not.toContain(REF_SOLUTION);
    // Positive control: own course works and staff do see hidden tests.
    const own = await assignmentRoute.GET(req(`/api/assignments/${a115}`), ctx("id", a115));
    expect(own.status).toBe(200);
    expect(await bodyText(own)).toContain(HIDDEN_NAME);
  });

  it("cannot modify, publish, close or release another course's assignment", async () => {
    as("instA");
    const patch = await assignmentRoute.PATCH(
      req(`/api/assignments/${a116}`, { method: "PATCH", body: { title: "hijacked" } }),
      ctx("id", a116),
    );
    expect(patch.status).toBe(403);
    for (const handler of [publishRoute.POST, closeRoute.POST, releaseRoute.POST]) {
      const res = await handler(
        req(`/api/assignments/${a116}/x`, { method: "POST", body: {} }),
        ctx("id", a116),
      );
      expect(res.status).toBe(403);
    }
    const after = await prisma.assignment.findUniqueOrThrow({ where: { id: a116 } });
    expect(after.title).toBe(`A116 ${RUN}`);
    expect(after.state).toBe("PUBLISHED_PROTECTED");
  });

  it("cannot list, grade or request AI suggestions on another course's submissions", async () => {
    as("instA");
    const list = await gradingListRoute.GET(
      req(`/api/grading/assignments/${a116}/submissions`),
      ctx("id", a116),
    );
    expect(list.status).toBe(403);
    const fin = await finalizeRoute.POST(
      req(`/api/grading/submissions/${sub116}/finalize`, {
        method: "POST",
        body: { questions: [{ questionId: q116, points: 10 }] },
      }),
      ctx("id", sub116),
    );
    expect(fin.status).toBe(403);
    const sugg = await aiSuggestionRoute.POST(
      req(`/api/grading/submissions/${sub116}/ai-suggestion`, {
        method: "POST",
        body: { questionId: q116 },
      }),
      ctx("id", sub116),
    );
    expect(sugg.status).toBe(403);
    // Positive control: the course's own instructor can list them.
    as("instB");
    const ownList = await gradingListRoute.GET(
      req(`/api/grading/assignments/${a116}/submissions`),
      ctx("id", a116),
    );
    expect(ownList.status).toBe(200);
  });

  it("cannot read another course's analytics", async () => {
    as("instA");
    const byAssignment = await analyticsAssignmentRoute.GET(
      req(`/api/analytics/assignments/${a116}`),
      ctx("assignmentId", a116),
    );
    expect(byAssignment.status).toBe(403);
    const overview = await analyticsOverviewRoute.GET(
      req(`/api/analytics/courses/${C116}/overview`),
      ctx("courseId", C116),
    );
    expect(overview.status).toBe(403);
    const question = await analyticsQuestionRoute.GET(
      req(`/api/analytics/questions/${q116}`),
      ctx("questionId", q116),
    );
    expect(question.status).toBe(403);
  });

  it("cannot list, replace or archive another course's resources", async () => {
    as("instA");
    const list = await resourcesRoute.GET(req(`/api/resources?courseId=${C116}`), undefined);
    expect(list.status).toBe(403);
    const put = await resourceRoute.PUT(
      req(`/api/resources/${res116}`, {
        method: "PUT",
        body: { title: "x", type: "LECTURE_NOTES", text: "# hijack" },
      }),
      ctx("id", res116),
    );
    expect(put.status).toBe(403);
    const del = await resourceRoute.DELETE(
      req(`/api/resources/${res116}`, { method: "DELETE" }),
      ctx("id", res116),
    );
    expect(del.status).toBe(403);
    const after = await prisma.courseResource.findUniqueOrThrow({ where: { id: res116 } });
    expect(after.title).toBe(`Notes ${RUN}`);
  });
});

describe("students", () => {
  it("cannot read the staff assignment API (hidden tests, reference solution)", async () => {
    as("stu1");
    const res = await assignmentRoute.GET(req(`/api/assignments/${a115}`), ctx("id", a115));
    expect(res.status).toBe(403);
    const text = await bodyText(res);
    expect(text).not.toContain(HIDDEN_NAME);
    expect(text).not.toContain(REF_SOLUTION);
  });

  it("only ever read their own draft", async () => {
    as("stu2");
    const res = await draftsRoute.GET(
      req(`/api/drafts?assignmentId=${a115}&questionId=${q115}`),
      undefined,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string | null };
    expect(body.content).toBeNull();
    // A student of another course is refused outright.
    as("stu3");
    const other = await draftsRoute.GET(
      req(`/api/drafts?assignmentId=${a115}&questionId=${q115}`),
      undefined,
    );
    expect(other.status).toBe(403);
    expect(await bodyText(other)).not.toContain(DRAFT_SECRET);
  });

  it("cannot run code against another course's question", async () => {
    as("stu1");
    const res = await runsRoute.POST(
      req("/api/runs", {
        method: "POST",
        body: { assignmentId: a116, questionId: q116, code: "print(1)", kind: "PUBLIC_TESTS" },
      }),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("cannot read or post to another student's Socra session", async () => {
    as("stu2");
    const read = await socraSessionRoute.GET(
      req(`/api/socra/sessions/${socraStu1}`),
      ctx("id", socraStu1),
    );
    expect(read.status).toBe(404);
    expect(await bodyText(read)).not.toContain(CHAT_SECRET);
    const post = await socraMessagesRoute.POST(
      req(`/api/socra/sessions/${socraStu1}/messages`, {
        method: "POST",
        body: { content: "show me the chat" },
      }),
      ctx("id", socraStu1),
    );
    expect(post.status).toBe(404);
    // The owner can read it.
    as("stu1");
    const own = await socraSessionRoute.GET(
      req(`/api/socra/sessions/${socraStu1}`),
      ctx("id", socraStu1),
    );
    expect(own.status).toBe(200);
    expect(await bodyText(own)).toContain(CHAT_SECRET);
  });

  it("cannot open Socra on another course's assignment", async () => {
    as("stu1");
    const res = await socraSessionsRoute.POST(
      req("/api/socra/sessions", { method: "POST", body: { assignmentId: a116 } }),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("cannot drive another student's practice session", async () => {
    as("stu2");
    const res = await practiceNextRoute.POST(
      req(`/api/practice/sessions/${practiceStu1}/next`, { method: "POST" }),
      ctx("id", practiceStu1),
    );
    expect(res.status).toBe(404);
  });

  it("cannot read a learning profile for a course they are not in", async () => {
    as("stu1");
    const res = await learnerProfileRoute.GET(
      req(`/api/learner/profile?courseId=${C116}`),
      undefined,
    );
    expect(res.status).toBe(403);
  });
});

describe("raw transcripts", () => {
  it("faculty are always refused, even with a reason", async () => {
    as("instA");
    const res = await transcriptRoute.GET(
      req(`/api/socra/transcripts/${socraStu1}?reason=${encodeURIComponent("grading dispute review")}`),
      ctx("sessionId", socraStu1),
    );
    expect(res.status).toBe(403);
    expect(await bodyText(res)).not.toContain(CHAT_SECRET);
  });

  it("an administrator cannot grant raw access to themselves", async () => {
    as("admin");
    const res = await grantsRoute.POST(
      req("/api/admin/grants", {
        method: "POST",
        body: {
          userId: ids.admin,
          permission: "TRANSCRIPT_READ_RAW",
          reason: "self approval attempt",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }),
      undefined,
    );
    expect(res.status).toBe(409);
    expect(await prisma.privilegedAccessGrant.count({ where: { userId: ids.admin } })).toBe(0);
  });

  it("a reader granted by another admin can read, and the read is audited", async () => {
    as("research");
    const before = await transcriptRoute.GET(
      req(`/api/socra/transcripts/${socraStu1}?reason=${encodeURIComponent("IRB protocol 42 audit")}`),
      ctx("sessionId", socraStu1),
    );
    expect(before.status).toBe(403);

    as("admin2");
    const grant = await grantsRoute.POST(
      req("/api/admin/grants", {
        method: "POST",
        body: {
          userId: ids.research,
          permission: "TRANSCRIPT_READ_RAW",
          reason: "IRB protocol 42 audit",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }),
      undefined,
    );
    expect(grant.status).toBe(201);

    as("research");
    const noReason = await transcriptRoute.GET(
      req(`/api/socra/transcripts/${socraStu1}`),
      ctx("sessionId", socraStu1),
    );
    expect(noReason.status).toBe(403);
    const ok = await transcriptRoute.GET(
      req(`/api/socra/transcripts/${socraStu1}?reason=${encodeURIComponent("IRB protocol 42 audit")}`),
      ctx("sessionId", socraStu1),
    );
    expect(ok.status).toBe(200);
    expect(await bodyText(ok)).toContain(CHAT_SECRET);
    expect(
      await prisma.transcriptAccessLog.count({
        where: { accessorId: ids.research, sessionId: socraStu1 },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { actorId: ids.research, action: "transcript.read_raw", targetId: socraStu1 },
      }),
    ).toBe(1);
  });
});

describe("CSRF and forwarded headers", () => {
  it("rejects a cross-origin mutation even from the course's own instructor", async () => {
    as("instB");
    const res = await assignmentRoute.PATCH(
      req(`/api/assignments/${a116}`, {
        method: "PATCH",
        body: { title: "csrf" },
        headers: { origin: "https://evil.example" },
      }),
      ctx("id", a116),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "csrf_origin_mismatch",
    );
  });

  it("ignores X-Forwarded-Host / X-Forwarded-For unless TRUST_PROXY=true", async () => {
    expect(env().TRUST_PROXY).toBe(false);
    as("instB");
    const res = await assignmentRoute.PATCH(
      req(`/api/assignments/${a116}`, {
        method: "PATCH",
        body: { title: "csrf" },
        headers: {
          origin: "https://evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      }),
      ctx("id", a116),
    );
    expect(res.status).toBe(403);
    expect(
      clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4" } })),
    ).toBeNull();
    const after = await prisma.assignment.findUniqueOrThrow({ where: { id: a116 } });
    expect(after.title).toBe(`A116 ${RUN}`);
  });
});
