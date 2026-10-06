import { sid } from "./context";
import { DIALOGUES, ESCALATION, LEAK_ATTEMPT, type Turn } from "./data/dialogues";
import type { VariantDef } from "./data/types";
import { buildAiSession } from "./ai-sim";
import { addEvidence, addObservation } from "./evidence";
import { clampAt, pFirst, skillFor, type Acc, type CourseKey, type Student } from "./sim";
import { clamp, intBetween, MIN_MS, sha, type AssignmentRef, type QuestionRef } from "./state";

export const CORRECT_OUT: Record<string, string> = {
  "count-down": "[3, 2, 1]\n",
  "sum-digits": "6\n",
  "running-totals": "[1, 3, 6]\n",
  "remove-negatives": "[1, 3]\n",
  "sum-evens": "6\n",
  "longest-word": "abc\n",
  "list-length": "4\n",
  "index-of": "1\n",
  inorder: "1 2 3\n",
  height: "3\n",
};

export interface VariantLike {
  key: string;
  code: string;
  failing: string[];
  out: string;
  err?: VariantDef["err"];
  misconception?: string;
  synthetic?: "syntax";
  syntheticErr?: string;
}

export interface Episode {
  q: QuestionRef;
  finalVariant: VariantLike;
  finalCode: string;
  passedAll: boolean;
  finalFrac: number;
  firstPublicFrac: number | null;
  firstPublicRunId: string | null;
  firstPublicEventId: string | null;
  lastRunId: string | null;
  lastEventId: string | null;
  publicPassed: number;
  publicTotal: number;
  testsPassed: number;
  testsTotal: number;
  startMs: number;
  endMs: number;
  draftVersion: number;
  ai: { sessionId: string; maxLevel: number; turns: number; eventId: string; at: number } | null;
  seenMisc: string[];
  publicRunCount: number;
}

function demoLine(starter: string | undefined): string {
  const lines = (starter ?? "").trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  return /^(print|console\.log)\(/.test(last) ? `\n\n${last}\n` : "\n";
}

function makeSyntaxVariant(code: string, language: string): VariantLike {
  if (language === "SCALA") {
    const idx = code.split("\n").findIndex((l) => l.includes(":::"));
    return {
      key: "compile-error",
      code: code.replace(":::", "+"),
      failing: [],
      out: "",
      synthetic: "syntax",
      syntheticErr: `Main.scala:${idx + 1}:30: error: value + is not a member of List[Int]\n    case Node(l, v, r) => inorder(l) + (v :: inorder(r))\n                                   ^\n1 error found`,
    };
  }
  if (language === "JAVASCRIPT") {
    const trimmed = code.trimEnd().replace(/\}\s*$/, "");
    const lines = trimmed.split("\n").length;
    return {
      key: "syntax-error",
      code: trimmed + "\n",
      failing: [],
      out: "",
      synthetic: "syntax",
      syntheticErr: `/main.js:${lines}\n\nSyntaxError: Unexpected end of input`,
    };
  }
  const lines = code.split("\n");
  const idx = lines.findIndex((l) => /^def .*\):\s*$/.test(l));
  const broken = lines.map((l, i) => (i === idx ? l.replace(/:\s*$/, "") : l)).join("\n");
  const shown = (lines[idx] ?? "").replace(/:\s*$/, "");
  return {
    key: "syntax-error",
    code: broken,
    failing: [],
    out: "",
    synthetic: "syntax",
    syntheticErr: `  File "main.py", line ${idx + 1}\n    ${shown}\n${" ".repeat(4 + shown.length)}^\nSyntaxError: expected ':'`,
  };
}

function fractionPassed(q: QuestionRef, v: VariantLike, visibility?: "PUBLIC" | "HIDDEN") {
  const failing = new Set(v.failing);
  const tests = q.def.tests.filter((t) => !visibility || t.visibility === visibility);
  const total = tests.reduce((s, t) => s + t.weight, 0);
  const ok = tests.filter((t) => !failing.has(t.id));
  return {
    frac: total ? ok.reduce((s, t) => s + t.weight, 0) / total : 0,
    passed: ok.length,
    total: tests.length,
  };
}

export { fractionPassed };

interface EpisodeArgs {
  acc: Acc;
  st: Student;
  asg: AssignmentRef;
  q: QuestionRef;
  courseKey: CourseKey;
  r: () => number;
  t0: number;
  attemptNo: number;
  prev?: VariantLike;
  forceEscalate?: boolean;
}

export function simulateCodingEpisode(a: EpisodeArgs): Episode {
  const { acc, st, asg, q, r } = a;
  const def = q.def;
  const language = def.language as string;
  const courseId = asg.courseId;
  const lang = def.language;
  const sectionId = st.section[a.courseKey]
    ? sid("section", a.courseKey, st.section[a.courseKey] as string)
    : null;
  const demo = demoLine(def.starterCode);
  const isStdio = def.tests[0]?.kind === "stdio";
  const withDemo = (code: string) => (isStdio ? code : code.trimEnd() + demo);

  const mk = (v: VariantDef): VariantLike => ({ ...v, code: withDemo(v.code) });
  const starter = def.variants.find((v) => v.key === "starter");
  const bugs = def.variants.filter((v) => v.key !== "starter").map(mk);
  const ref: VariantLike = {
    key: "reference",
    code: withDemo(def.reference ?? ""),
    failing: [],
    out: CORRECT_OUT[def.key] ?? "\n",
  };
  const skill = skillFor(st, def.topics);
  const p1 = pFirst(skill, def.difficulty);
  const maxRuns = a.prev ? 2 + Math.floor(r() * 2) : 2 + Math.floor(st.persist * 5);

  type Attempt = { v: VariantLike; aiAfter?: boolean };
  const attempts: Attempt[] = [];
  let passed = false;
  let aiBoost = 0;
  let aiAfterIdx = -1;
  let last: VariantLike | null = a.prev ?? null;
  if (!a.prev && starter && r() < 0.55) {
    attempts.push({ v: mk(starter) });
    last = mk(starter);
  }
  for (let t = 1; t <= maxRuns; t++) {
    const base = a.prev ? 0.4 : p1;
    const pass = r() < clamp(base + 0.13 * (t - 1) + aiBoost, 0.02, 0.97);
    if (pass) {
      attempts.push({ v: ref });
      passed = true;
      break;
    }
    if (t === 1 && !a.prev && r() < 0.22)
      attempts.push({ v: makeSyntaxVariant(ref.code, language) });
    // choose a buggy variant; misconception-bearing variants are more likely, repeats are possible
    const pool = bugs.length ? bugs : [ref];
    const weighted = pool.flatMap((v) => (v.misconception ? [v, v] : [v]));
    let pickV = weighted[Math.floor(r() * weighted.length)] as VariantLike;
    if (last && last.key === pickV.key && r() < 0.5 && pool.length > 1) {
      pickV = pool.find((v) => v.key !== last?.key) as VariantLike;
    }
    attempts.push({ v: pickV });
    last = pickV;
    const wantsAi =
      a.forceEscalate ||
      (!a.prev &&
        t <= 2 &&
        st.condition !== "CONTROL" &&
        asg.def.policyMaxLevel >= 2 &&
        DIALOGUES[def.key] !== undefined &&
        r() < Math.min(0.97, st.aiProp * 1.6));
    if (wantsAi && aiAfterIdx < 0) {
      aiAfterIdx = attempts.length - 1;
      attempts[aiAfterIdx]!.aiAfter = true;
      aiBoost = (a.forceEscalate ? 0.05 : st.receptive * 0.5) * (0.7 + 0.6 * r());
    }
  }
  if (!passed) {
    // gave up on the last attempt unless they had only run the starter
    if (attempts.length === 0 || attempts.every((x) => x.v.key === "starter")) {
      attempts.push({ v: bugs[0] ?? ref });
    }
  }
  const finalVariant = attempts[attempts.length - 1]!.v;

  // ---- materialize attempts as runs, draft saves and events
  let t = a.t0;
  let draftVersion = 0;
  let firstPublicFrac: number | null = null;
  let firstPublicRunId: string | null = null;
  let firstPublicEventId: string | null = null;
  let lastRunId: string | null = null;
  let lastEventId: string | null = null;
  let publicRunCount = 0;
  let ai: Episode["ai"] = null;
  const seenMisc = new Set<string>();
  const evBase = {
    actorId: st.id,
    courseId,
    sectionId,
    assignmentId: asg.id,
    assignmentVersion: asg.version,
    questionId: q.id,
    questionVersion: 1,
    condition: st.condition,
  };
  const draftId = sid("draft", st.key, q.id);
  const sampleStdin = isStdio
    ? ((def.key === "inorder" ? def.tests.find((x) => x.id === "t2") : def.tests[0])?.stdin ?? "")
    : null;

  acc.events.add({
    ...evBase,
    name: "question_viewed",
    key: `qview:${st.key}:${q.id}:${a.attemptNo}`,
    at: clampAt(t),
    metadata: {},
  });

  attempts.forEach((att, idx) => {
    const v = att.v;
    t +=
      idx === 0
        ? intBetween(r, 20, 90) * 1000
        : r() < 0.12
          ? intBetween(r, 20, 90) * MIN_MS
          : intBetween(r, 2, 16) * MIN_MS;
    const isLastAttempt = idx === attempts.length - 1;

    // autosave
    draftVersion += 1;
    const draftAt = clampAt(t);
    acc.events.add({
      ...evBase,
      name: "draft_saved",
      key: `draft:${st.key}:${q.id}:${a.attemptNo}:${idx}`,
      at: draftAt,
      metadata: {
        draftVersion,
        contentHash: sha(v.code).slice(0, 16),
        byteCount: Buffer.byteLength(v.code),
      },
    });
    const prior = acc.drafts.get(draftId);
    acc.drafts.set(draftId, {
      id: draftId,
      userId: st.id,
      assignmentId: asg.id,
      questionId: q.id,
      content: v.code,
      language: def.language,
      version: draftVersion + (a.attemptNo > 1 ? 3 : 0),
      contentHash: sha(v.code),
      clientUpdatedAt: draftAt,
      createdAt: (prior?.createdAt as Date | undefined) ?? draftAt,
      updatedAt: draftAt,
    });

    const kinds: Array<"RUN" | "PUBLIC_TESTS"> = ["RUN"];
    if (r() < 0.75 || isLastAttempt) kinds.push("PUBLIC_TESTS");
    kinds.forEach((kind, ki) => {
      t += ki * intBetween(r, 6, 40) * 1000;
      const runId = sid("run", st.key, asg.courseKey, asg.key, def.key, a.attemptNo, idx, kind);
      const timeoutVariant = v.err?.status === "TIMEOUT";
      let status: string;
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = 0;
      let errorClass: string | null = null;
      let duration =
        lang === "SCALA"
          ? intBetween(r, 2600, 6500)
          : lang === "JAVASCRIPT"
            ? intBetween(r, 40, 140)
            : intBetween(r, 25, 170);
      let testResults: unknown = null;
      let testsPassed: number | null = null;
      let testsTotal: number | null = null;

      if (kind === "RUN") {
        if (v.synthetic) {
          status = "COMPILE_ERROR";
          stderr = v.syntheticErr ?? "";
          exitCode = 1;
          errorClass = "STUDENT_COMPILE";
        } else if (v.err) {
          status = v.err.status;
          stderr = v.err.text;
          exitCode = v.err.status === "TIMEOUT" ? null : 1;
          errorClass = v.err.status === "TIMEOUT" ? "STUDENT_TIMEOUT" : "STUDENT_RUNTIME";
          if (v.err.status === "TIMEOUT") duration = 5000 + intBetween(r, 0, 120);
        } else {
          status = "OK";
          stdout = v.out;
        }
      } else {
        publicRunCount++;
        const failing = new Set(v.failing);
        const pubs = def.tests.filter((x) => x.visibility === "PUBLIC");
        if (v.synthetic) {
          status = "COMPILE_ERROR";
          stderr = v.syntheticErr ?? "";
          exitCode = 1;
          errorClass = "STUDENT_COMPILE";
          testResults = [];
          testsPassed = 0;
          testsTotal = pubs.length;
        } else {
          status = timeoutVariant ? "TIMEOUT" : "OK";
          if (timeoutVariant) {
            exitCode = null;
            errorClass = "STUDENT_TIMEOUT";
            duration = 5000 + intBetween(r, 0, 120);
            stderr = v.err?.text ?? "";
          }
          const results = pubs.map((x) => {
            const ok = !failing.has(x.id);
            return {
              testId: x.id,
              name: x.name,
              visibility: "PUBLIC",
              passed: ok,
              weight: x.weight,
              ...(ok
                ? {}
                : {
                    message: timeoutVariant
                      ? "Timed out"
                      : v.err?.status === "RUNTIME_ERROR"
                        ? "RecursionError: maximum recursion depth exceeded"
                        : (x.failureHint ?? "Output did not match the expected result."),
                  }),
              expected:
                x.kind === "function"
                  ? JSON.stringify(x.expectedReturn)
                  : (x.expectedStdout ?? "").trim(),
              durationMs: intBetween(r, 1, 30),
            };
          });
          testResults = results;
          testsPassed = results.filter((x) => x.passed).length;
          testsTotal = results.length;
        }
      }

      const runAt = clampAt(t);
      const doneAt = clampAt(t + duration + intBetween(r, 400, 1400));
      acc.runs.push({
        id: runId,
        userId: st.id,
        courseId,
        assignmentId: asg.id,
        questionId: q.id,
        kind,
        language: def.language,
        status,
        codeSnapshot: v.code,
        codeHash: sha(v.code),
        stdin: kind === "RUN" ? sampleStdin : null,
        stdout,
        stderr,
        exitCode,
        durationMs: duration,
        testResults: testResults ?? undefined,
        testsPassed,
        testsTotal,
        runnerDriver: "docker",
        errorClass,
        jobId: runId,
        draftVersion,
        queuedAt: runAt,
        startedAt: new Date(runAt.getTime() + 300),
        completedAt: doneAt,
      });
      acc.events.add({
        ...evBase,
        name: "code_run_requested",
        key: `runreq:${runId}`,
        at: runAt,
        metadata: { runId, kind, language: def.language, codeHash: sha(v.code).slice(0, 16) },
      });
      const completedId = acc.events.add({
        ...evBase,
        name: "code_run_completed",
        key: `runcmp:${runId}`,
        at: doneAt,
        metadata: {
          runId,
          kind,
          language: def.language,
          status,
          durationMs: duration,
          ...(testsTotal !== null
            ? { publicTestSummary: { passed: testsPassed, total: testsTotal } }
            : {}),
          ...(errorClass ? { errorClass } : {}),
        },
      });
      lastRunId = runId;
      lastEventId = completedId;
      if (kind === "PUBLIC_TESTS" && firstPublicFrac === null) {
        firstPublicFrac = testsTotal ? (testsPassed ?? 0) / testsTotal : 0;
        firstPublicRunId = runId;
        firstPublicEventId = completedId;
      }
      // rule-based misconception detection (once per misconception per episode)
      if (
        v.misconception &&
        !seenMisc.has(v.misconception) &&
        (kind === "RUN" || publicRunCount > 0)
      ) {
        seenMisc.add(v.misconception);
        addObservation({
          acc,
          st,
          courseKey: a.courseKey,
          courseId,
          misconceptionKey: v.misconception,
          key: `${asg.key}:${def.key}:${a.attemptNo}:${v.misconception}`,
          confidence: 0.68 + r() * 0.27,
          method: "RULE",
          at: new Date(doneAt.getTime() + 1500),
          assignmentId: asg.id,
          questionId: q.id,
          codeRunId: runId,
          reviewStatus: r() < 0.25 ? "APPROVED" : "PENDING",
          sourceEventId: completedId,
        });
      }
    });

    // Socra conversation after a failing attempt
    if (att.aiAfter) {
      const script = a.forceEscalate ? ESCALATION : (DIALOGUES[def.key] as Turn[]);
      let turns: Turn[];
      let leaky = false;
      if (a.forceEscalate) turns = script;
      else if (r() < st.leaky) {
        leaky = true;
        turns = [...LEAK_ATTEMPT, ...script.slice(1, 3)];
      } else
        turns = script.slice(0, Math.min(script.length, 2 + Math.floor(r() * (script.length - 1))));
      const sessionStart = t + intBetween(r, 60, 180) * 1000;
      const res = buildAiSession({
        acc,
        st,
        courseKey: a.courseKey,
        courseId,
        mode: "PROTECTED_ASSESSMENT",
        assignment: asg,
        question: q,
        topicKey: def.topics[0]!.key,
        turns,
        startMs: sessionStart,
        r,
        key: `${st.key}:${asg.courseKey}:${asg.key}:${def.key}:${a.attemptNo}`,
        ...(a.forceEscalate
          ? {
              forceStatus: "ESCALATED" as const,
              escalationNote:
                "I would like a staff member to check in with me about this assignment.",
            }
          : {}),
        firstReplyRevised: leaky,
      });
      ai = {
        sessionId: res.sessionId,
        maxLevel: res.maxLevel,
        turns: res.turnCount,
        eventId: res.firstEventId,
        at: sessionStart,
      };
      t = res.endMs + intBetween(r, 30, 240) * 1000;
      // LLM-extracted observation tied to the session (lower confidence)
      const mk0 = v.misconception;
      if (mk0 && r() < 0.7) {
        addObservation({
          acc,
          st,
          courseKey: a.courseKey,
          courseId,
          misconceptionKey: mk0,
          key: `${asg.key}:${def.key}:${a.attemptNo}:${mk0}:ai`,
          confidence: 0.5 + r() * 0.3,
          method: "LLM",
          at: new Date(res.endMs + 5000),
          assignmentId: asg.id,
          questionId: q.id,
          aiSessionId: res.sessionId,
          reviewStatus: "PENDING",
        });
      }
    }
  });

  const full = fractionPassed(q, finalVariant);
  const pub = fractionPassed(q, finalVariant, "PUBLIC");
  const hid = fractionPassed(q, finalVariant, "HIDDEN");
  void hid;
  const finalCode = finalVariant.code;
  const ep: Episode = {
    q,
    finalVariant,
    finalCode,
    passedAll: finalVariant.failing.length === 0 && !finalVariant.synthetic,
    finalFrac: finalVariant.synthetic ? 0 : full.frac,
    firstPublicFrac,
    firstPublicRunId,
    firstPublicEventId,
    lastRunId,
    lastEventId,
    publicPassed: finalVariant.synthetic ? 0 : pub.passed,
    publicTotal: pub.total,
    testsPassed: finalVariant.synthetic ? 0 : full.passed,
    testsTotal: full.total,
    startMs: a.t0,
    endMs: t,
    draftVersion,
    ai,
    seenMisc: [...seenMisc],
    publicRunCount,
  };

  // ---- episode-level evidence (source: code runs and Socra)
  const evCommon = (topic: { id: string; weight: number }) => ({
    acc,
    st,
    courseKey: a.courseKey,
    courseId,
    topicId: topic.id,
    weight: topic.weight,
    assignmentId: asg.id,
    assignmentVersion: asg.version,
    questionId: q.id,
    difficulty: def.difficulty,
    attemptNumber: a.attemptNo,
    condition: st.condition,
    at: clampAt(t),
  });
  for (const topic of q.topicIds) {
    if (firstPublicFrac !== null && a.attemptNo === 1) {
      addEvidence({
        ...evCommon(topic),
        key: `${asg.key}:${def.key}:first`,
        type: "FIRST_ATTEMPT_CORRECTNESS",
        sourceType: "CODE_RUN",
        sourceId: firstPublicRunId,
        sourceEventId: firstPublicEventId,
        value: firstPublicFrac,
        raw: {
          correct: firstPublicFrac === 1,
          publicFraction: Math.round(firstPublicFrac * 100) / 100,
        },
      });
    }
    if (publicRunCount > 1 && firstPublicFrac !== null && firstPublicFrac < 1) {
      addEvidence({
        ...evCommon(topic),
        key: `${asg.key}:${def.key}:${a.attemptNo}:retry`,
        type: "RETRY_IMPROVEMENT",
        sourceType: "CODE_RUN",
        sourceId: lastRunId,
        sourceEventId: lastEventId,
        value: clamp(ep.finalFrac - firstPublicFrac, 0, 1),
        raw: {
          from: Math.round(firstPublicFrac * 100) / 100,
          to: Math.round(ep.finalFrac * 100) / 100,
          runs: publicRunCount,
        },
        weight: topic.weight * 0.6,
      });
    }
    if (ai) {
      const aiInfo = ai as NonNullable<Episode["ai"]>;
      addEvidence({
        ...evCommon(topic),
        key: `${asg.key}:${def.key}:${a.attemptNo}:socra`,
        type: "SOCRA_USAGE",
        sourceType: "SOCRA_SESSION",
        sourceId: aiInfo.sessionId,
        sourceEventId: aiInfo.eventId,
        value: Math.min(1, aiInfo.turns / 6),
        raw: { turns: aiInfo.turns },
        assisted: true,
        maxLevel: aiInfo.maxLevel,
        aiSessionId: aiInfo.sessionId,
        weight: topic.weight * 0.5,
      });
      addEvidence({
        ...evCommon(topic),
        key: `${asg.key}:${def.key}:${a.attemptNo}:depth`,
        type: "INTERVENTION_DEPTH",
        sourceType: "SOCRA_SESSION",
        sourceId: aiInfo.sessionId,
        sourceEventId: aiInfo.eventId,
        value: aiInfo.maxLevel / 6,
        raw: { hintDepth: aiInfo.maxLevel },
        assisted: true,
        maxLevel: aiInfo.maxLevel,
        aiSessionId: aiInfo.sessionId,
        weight: topic.weight * 0.5,
      });
      const before = firstPublicFrac ?? 0;
      addEvidence({
        ...evCommon(topic),
        key: `${asg.key}:${def.key}:${a.attemptNo}:recovery`,
        type: "RECOVERY_AFTER_GUIDANCE",
        sourceType: "SOCRA_SESSION",
        sourceId: aiInfo.sessionId,
        sourceEventId: lastEventId,
        value: ep.passedAll ? 1 : clamp(ep.finalFrac - before, 0, 1),
        raw: { recovered: ep.passedAll },
        assisted: true,
        maxLevel: aiInfo.maxLevel,
        aiSessionId: aiInfo.sessionId,
        weight: topic.weight * 0.8,
      });
    }
  }
  return ep;
}
