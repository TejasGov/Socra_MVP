import { enrollmentPlan } from "./courses";
import { rng, sid, type SeedContext } from "./context";
import { REVIEW } from "./data/dialogues";
import { buildAiSession } from "./ai-sim";
import { simulateCodingEpisode, type Episode } from "./coding-sim";
import { conditionFor } from "./research";
import { clampAt, newAcc, type Acc, type CourseKey, type Student } from "./sim";
import { simulatePractice } from "./practice-sim";
import {
  bulk,
  clamp,
  count,
  DAY_MS,
  HOUR_MS,
  intBetween,
  MIN_MS,
  S,
  SEED_CONSTANT,
  type AssignmentRef,
} from "./state";
import { recordCodingSubmission, simulateQuiz, type StaffIds } from "./submit-sim";
import { finishDerivedData } from "./derive";
import { STUDENT_COUNT } from "./users";

const BASE_ADJ: Record<string, number> = {
  variables: 0.1,
  "control-flow": 0.05,
  functions: 0.05,
  lists: 0.03,
  recursion: -0.05,
  "recursion-base-cases": -0.2,
  "call-stack-tracing": -0.06,
  "asymptotic-complexity": -0.04,
  "linked-structures": -0.02,
  trees: -0.08,
  traversal: -0.15,
};
const ALL_TOPICS = Object.keys(BASE_ADJ);

function buildStudents(ctx: SeedContext): Student[] {
  const plan = enrollmentPlan().filter((p) => p.role === "STUDENT");
  const out: Student[] = [];
  for (let n = 1; n <= STUDENT_COUNT; n++) {
    const key = `student${n}`;
    const r = rng(SEED_CONSTANT + n * 7919);
    let ability = 0.2 + 0.7 * Math.pow(r(), 1.2);
    const adj: Record<string, number> = {};
    for (const t of ALL_TOPICS) adj[t] = (BASE_ADJ[t] as number) + (r() - 0.5) * 0.24;
    let aiProp = 0.3 + 0.5 * r();
    let receptive = 0.9 * Math.pow(r(), 1.4);
    let persist = 0.2 + 0.8 * r();
    let leaky = r() < 0.2 ? 0.3 : 0.06;
    if (n === 1) {
      // mixed profile: strong on lists/loops, weak-but-recovering on base cases, developing elsewhere
      ability = 0.55;
      Object.assign(adj, {
        variables: 0.2,
        "control-flow": 0.22,
        functions: 0.1,
        lists: 0.25,
        recursion: 0,
        "recursion-base-cases": -0.27,
        "call-stack-tracing": 0.04,
        "linked-structures": 0.15,
        trees: 0,
        traversal: -0.12,
        "asymptotic-complexity": 0.05,
      });
      aiProp = 0.75;
      receptive = 0.75;
      persist = 0.7;
      leaky = 0.05;
    } else if (n === 2) {
      ability = 0.87;
      for (const t of ALL_TOPICS) adj[t] = 0;
      adj["recursion-base-cases"] = -0.06;
      aiProp = 0.12;
      receptive = 0.4;
      persist = 0.9;
      leaky = 0.02;
    } else if (n === 3) {
      ability = 0.3;
      for (const t of ALL_TOPICS) adj[t] = 0;
      adj["recursion-base-cases"] = -0.12;
      adj["recursion"] = -0.1;
      adj["lists"] = 0.06;
      aiProp = 0.92;
      receptive = 0.18;
      persist = 0.55;
      leaky = 0.35;
    }
    const courses = plan.filter((p) => p.userKey === key).map((p) => p.courseKey);
    const section: Student["section"] = {};
    for (const p of plan.filter((x) => x.userKey === key))
      if (p.section) section[p.courseKey] = p.section;
    out.push({
      n,
      key,
      id: ctx.ids.users[key] as string,
      name: key,
      ability,
      adj,
      condition: conditionFor(n),
      consented: n % 10 !== 0,
      aiProp,
      receptive,
      persist,
      leaky,
      courses,
      section,
    });
  }
  return out;
}

function lastEp(eps: Episode[]): Episode {
  return eps[eps.length - 1] as Episode;
}

function simulateAssignment(
  acc: Acc,
  st: Student,
  asg: AssignmentRef,
  idx: number,
  staff: StaffIds,
): void {
  const def = asg.def;
  if (
    def.state === "DRAFT" ||
    !asg.openAt ||
    asg.openAt.getTime() >= S.anchor.getTime() ||
    !asg.versionId
  )
    return;
  const courseKey = asg.courseKey as CourseKey;
  const r = rng(SEED_CONSTANT + st.n * 100003 + idx * 7919);
  const anchorMs = S.anchor.getTime();
  const forced = st.n <= 3 || st.n === 12;
  if (!forced && r() > def.startRate * (0.75 + 0.35 * st.persist)) return;

  const lateWindow = !def.closed && asg.dueAt && asg.dueAt.getTime() < anchorMs ? 2 * DAY_MS : 0;
  const endCap = Math.min((asg.dueAt?.getTime() ?? anchorMs) + lateWindow, anchorMs - 6 * HOUR_MS);
  const openMs = asg.openAt.getTime();
  const span = Math.max(0, endCap - openMs - 5 * HOUR_MS);
  const startMs = openMs + HOUR_MS + Math.pow(r(), 0.55) * span;
  const sectionId = st.section[courseKey]
    ? sid("section", courseKey, st.section[courseKey] as string)
    : null;

  acc.events.add({
    name: "assignment_opened",
    key: `aopen:${st.key}:${asg.id}`,
    at: clampAt(startMs),
    actorId: st.id,
    courseId: asg.courseId,
    sectionId,
    assignmentId: asg.id,
    assignmentVersion: asg.version,
    condition: st.condition,
    metadata: { mode: def.closed ? "REVIEW" : "PROTECTED" },
  });
  const common = { acc, st, asg, courseKey, r, staff, openedAt: startMs };

  if (def.format === "QUIZ") {
    if (!forced && r() > def.submitRate) return;
    simulateQuiz({ ...common, t0: startMs });
    return;
  }

  // ---- first attempt over all questions
  let t = startMs;
  const eps: Episode[] = [];
  for (const q of asg.questions) {
    const forceEscalate =
      asg.courseKey === "cse115" &&
      asg.key === "hw3" &&
      q.def.key === "count-down" &&
      (st.n === 3 || st.n === 12);
    const ep = simulateCodingEpisode({
      acc,
      st,
      asg,
      q,
      courseKey,
      r,
      t0: t,
      attemptNo: 1,
      forceEscalate,
    });
    eps.push(ep);
    t = ep.endMs + intBetween(r, 4, 25) * MIN_MS;
  }
  const willSubmit = forced || r() < def.submitRate;
  if (!willSubmit) {
    // in progress: drafts exist (written by the episodes) and progress row
    acc.progress.set(`${st.id}:${asg.id}`, {
      id: sid("prog", st.key, asg.courseKey, asg.key),
      userId: st.id,
      assignmentId: asg.id,
      status: "IN_PROGRESS",
      attemptsUsed: 0,
      firstOpenedAt: clampAt(startMs),
      lastActivityAt: clampAt(lastEp(eps).endMs),
    });
    return;
  }
  const submitAt = lastEp(eps).endMs + intBetween(r, 3, 12) * MIN_MS;
  const late = asg.dueAt ? submitAt > asg.dueAt.getTime() : false;
  recordCodingSubmission({ ...common, eps, attemptNo: 1, at: submitAt, late });

  // ---- optional resubmission for questions that did not fully pass
  const allowed = (def.attemptLimit ?? 1) > 1;
  const failed = eps.filter((e) => !e.passedAll);
  if (allowed && failed.length > 0 && r() < 0.5 * (0.4 + st.persist)) {
    let t2 = submitAt + intBetween(r, 4, 30) * HOUR_MS;
    if (t2 < endCap + lateWindow && t2 < anchorMs - 2 * HOUR_MS) {
      const eps2 = eps.map((e) => e);
      for (const [i, e] of eps.entries()) {
        if (e.passedAll) continue;
        const ep2 = simulateCodingEpisode({
          acc,
          st,
          asg,
          q: e.q,
          courseKey,
          r,
          t0: t2,
          attemptNo: 2,
          prev: e.finalVariant,
        });
        eps2[i] = ep2;
        t2 = ep2.endMs + intBetween(r, 3, 15) * MIN_MS;
      }
      const at2 = t2 + intBetween(r, 2, 8) * MIN_MS;
      recordCodingSubmission({
        ...common,
        eps: eps2,
        attemptNo: 2,
        at: at2,
        late: asg.dueAt ? at2 > asg.dueAt.getTime() : false,
      });
    }
  }
}

function reviewSessions(acc: Acc, students: Student[]): void {
  const hw3 = S.assignments.find((a) => a.courseKey === "cse115" && a.key === "hw3");
  if (!hw3) return;
  const q = hw3.questions[0];
  if (!q) return;
  const releasedAt = (hw3.dueAt as Date).getTime() + 2 * DAY_MS;
  for (const st of students) {
    if (!st.courses.includes("cse115") || st.condition === "CONTROL") continue;
    const sub = acc.submissions.find(
      (s) => s.userId === st.id && s.assignmentId === hw3.id && s.attemptNumber === 1,
    );
    if (!sub) continue;
    const r = rng(SEED_CONSTANT + st.n * 6007);
    // students who lost points on hidden tests review the solution with Socra
    const lost = acc.grades.find((g) => g.submissionId === sub.id && g.questionId === q.id);
    const pts = (lost?.finalScore as number | undefined) ?? 10;
    if (!(pts < 10 && r() < 0.65) && st.n !== 1) continue;
    buildAiSession({
      acc,
      st,
      courseKey: "cse115",
      courseId: hw3.courseId,
      mode: "POST_ASSESSMENT_REVIEW",
      assignment: hw3,
      question: q,
      topicKey: "recursion-base-cases",
      turns: REVIEW,
      startMs: releasedAt + intBetween(r, 3, 100) * HOUR_MS,
      r,
      key: `review:${st.key}:hw3`,
    });
  }
}

function facultyAndSetupEvents(ctx: SeedContext, acc: Acc, students: Student[]): void {
  const faculty = ctx.ids.users["faculty"] as string;
  const research = ctx.ids.users["research"] as string;
  const anchor = S.anchor.getTime();
  for (const asg of S.assignments) {
    const def = asg.def;
    const base = {
      actorId: faculty,
      courseId: asg.courseId,
      assignmentId: asg.id,
      condition: null,
    };
    const created = (asg.openAt?.getTime() ?? anchor - 5 * DAY_MS) - 6 * DAY_MS;
    acc.events.add({
      ...base,
      name: "assignment_created",
      key: `acreated:${asg.id}`,
      at: new Date(created),
      metadata: { format: def.format, aiGenerated: def.state === "DRAFT" },
    });
    if (def.state === "DRAFT") {
      acc.events.add({
        ...base,
        name: "assignment_ai_generated",
        key: `aigen:${asg.id}`,
        at: new Date(created + HOUR_MS),
        metadata: {
          suggestionId: sid("sugg", asg.courseKey, asg.key, "full"),
          kind: "full_assignment",
        },
      });
      continue;
    }
    acc.events.add({
      ...base,
      name: "assignment_published",
      key: `apub:${asg.id}`,
      at: new Date((asg.openAt as Date).getTime() - 2 * DAY_MS),
      assignmentVersion: 1,
      metadata: { versionId: asg.versionId as string },
    });
    if (def.closed) {
      acc.events.add({
        ...base,
        name: "assignment_closed",
        key: `aclosed:${asg.id}`,
        at: asg.dueAt as Date,
        assignmentVersion: 1,
        metadata: { trigger: "schedule" },
      });
      acc.events.add({
        ...base,
        name: "solutions_released",
        key: `asol:${asg.id}`,
        at: new Date((asg.dueAt as Date).getTime() + 2 * DAY_MS),
        assignmentVersion: 1,
        metadata: {},
      });
    }
  }
  // research condition assignment (setup time) and course opens
  for (const st of students) {
    for (const courseKey of st.courses) {
      const courseId = ctx.ids.courses[courseKey] as string;
      acc.events.add({
        name: "research_condition_assigned",
        key: `rca:${st.key}:${courseKey}`,
        at: new Date(anchor - 35 * DAY_MS + st.n * MIN_MS),
        actorId: st.id,
        courseId,
        condition: st.condition,
        metadata: { condition: st.condition, method: "seed-deterministic-v1" },
      });
      const r = rng(SEED_CONSTANT + st.n * 4241 + (courseKey === "cse115" ? 5 : 9));
      const opens = 3 + Math.floor(r() * 6);
      for (let i = 0; i < opens; i++) {
        acc.events.add({
          name: "course_opened",
          key: `copen:${st.key}:${courseKey}:${i}`,
          at: new Date(anchor - r() * 27 * DAY_MS - 3 * HOUR_MS),
          actorId: st.id,
          courseId,
          sectionId: st.section[courseKey]
            ? sid("section", courseKey, st.section[courseKey] as string)
            : null,
          condition: st.condition,
          metadata: {},
        });
      }
    }
  }
  // faculty looking at analytics
  const views = [
    "overview",
    "assignment_summary",
    "topic_insights",
    "question_drilldown",
    "misconceptions",
  ];
  for (let i = 0; i < 14; i++) {
    const courseKey = i % 3 === 2 ? "cse116" : "cse115";
    acc.events.add({
      name: "analytics_viewed",
      key: `aview:${i}`,
      at: new Date(anchor - (26 - i * 1.8) * DAY_MS),
      actorId: faculty,
      courseId: ctx.ids.courses[courseKey] as string,
      condition: null,
      metadata: {
        viewType: views[i % views.length] as string,
        scope: { courseId: ctx.ids.courses[courseKey] as string },
      },
    });
  }
  const hw3q = S.assignments.find((a) => a.courseKey === "cse115" && a.key === "hw3")?.questions[0];
  if (hw3q) {
    for (let i = 0; i < 3; i++) {
      acc.events.add({
        name: "question_insight_viewed",
        key: `qinsight:${i}`,
        at: new Date(anchor - (14 - i * 3) * DAY_MS),
        actorId: faculty,
        courseId: ctx.ids.courses["cse115"] as string,
        assignmentId:
          S.assignments.find((a) => a.courseKey === "cse115" && a.key === "hw3")?.id ?? null,
        assignmentVersion: 1,
        questionId: hw3q.id,
        condition: null,
        metadata: {},
      });
    }
  }
  void research;
}

export async function seedActivity(ctx: SeedContext): Promise<void> {
  const p = ctx.prisma;
  const acc = newAcc();
  const students = buildStudents(ctx);
  const staff: StaffIds = {
    faculty: ctx.ids.users["faculty"] as string,
    ta: ctx.ids.users["ta"] as string,
  };

  S.assignments.forEach((asg, idx) => {
    for (const st of students) {
      if (!st.courses.includes(asg.courseKey)) continue;
      simulateAssignment(acc, st, asg, idx, staff);
    }
  });
  reviewSessions(acc, students);
  simulatePractice(acc, students);
  facultyAndSetupEvents(ctx, acc, students);
  void clamp;

  ctx.log(
    `simulated: ${acc.submissions.length} submissions, ${acc.runs.length} code runs, ${acc.aiSessions.length} AI sessions, ` +
      `${acc.attempts.length} practice attempts, ${acc.evidence.length} evidence rows, ${acc.events.rows.length} events`,
  );

  // ---- persist in dependency order
  await bulk(p.draft, [...acc.drafts.values()]);
  await bulk(p.submission, acc.submissions);
  await bulk(p.submissionAnswer, acc.answers);
  await bulk(
    p.grade,
    acc.grades.map((g) => ({ ...g, rubricId: g.rubricId ?? null })),
  );
  await bulk(p.gradeOverrideAudit, acc.overrides);
  await bulk(p.assignmentProgress, [...acc.progress.values()]);
  await bulk(p.codeRun, acc.runs);
  await bulk(p.practiceSession, acc.practiceSessions);
  await bulk(p.practiceItemAttempt, acc.attempts);
  await bulk(p.aiSession, acc.aiSessions);
  await bulk(p.aiRequest, acc.aiRequests);
  await bulk(p.aiMessage, acc.messages);
  await bulk(p.policyDecision, acc.decisions);
  await bulk(p.retrievalCitation, acc.citations);
  await bulk(
    p.socraEscalation,
    acc.escalations.map((e) => ({ ...e, resolvedById: e.status === "RESOLVED" ? staff.ta : null })),
  );
  await bulk(p.misconceptionObservation, acc.obs);
  // append-only tables: stable ids + skipDuplicates make re-runs a no-op
  await bulk(p.learningEvidence, acc.evidence, { skipDuplicates: true });
  await bulk(p.analyticsEvent, acc.events.rows, { skipDuplicates: true });

  count("students", students.length);
  count("drafts", acc.drafts.size);
  count("submissions", acc.submissions.length);
  count("grades", acc.grades.length);
  count("codeRuns", acc.runs.length);
  count("practiceSessions", acc.practiceSessions.length);
  count("practiceAttempts", acc.attempts.length);
  count("aiSessions", acc.aiSessions.length);
  count("aiMessages", acc.messages.length);
  count("aiRequests", acc.aiRequests.length);
  count("misconceptionObservations", acc.obs.length);
  count("learningEvidence", acc.evidence.length);
  count("analyticsEvents", acc.events.rows.length);

  await finishDerivedData(ctx, acc, students);
}
