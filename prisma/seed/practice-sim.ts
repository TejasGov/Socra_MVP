import { rng, sid } from "./context";
import { PRACTICE_EXPLAIN } from "./data/dialogues";
import { buildAiSession } from "./ai-sim";
import { addEvidence, addObservation } from "./evidence";
import { sigmoid, type Acc, type CourseKey, type Student } from "./sim";
import { clamp, DAY_MS, intBetween, MIN_MS, S, SEED_CONSTANT, type PracticeItemRef } from "./state";
import { clampAt } from "./sim";

function wrongAnswer(item: PracticeItemRef, r: () => number): string {
  const d = item.def;
  if (d.type === "MULTIPLE_CHOICE") {
    const ids = (d.choices ?? []).map((c) => c.id).filter((x) => x !== d.answer);
    return ids[Math.floor(r() * ids.length)] ?? "a";
  }
  const n = Number(d.answer);
  if (!Number.isNaN(n) && d.answer.trim() !== "") return String(n + (r() < 0.5 ? 1 : -1));
  const generic = ["I am not sure", "an error", "0", "it returns the list", "O(n)"];
  return generic[Math.floor(r() * generic.length)] as string;
}

export function simulatePractice(acc: Acc, students: Student[]): void {
  for (const st of students) {
    for (const courseKey of st.courses) {
      const r = rng(SEED_CONSTANT + st.n * 9973 + (courseKey === "cse115" ? 1 : 2) * 31);
      const courseId = st.courses.length
        ? (S.assignments.find((a) => a.courseKey === courseKey)?.courseId as string)
        : "";
      const items = S.practiceItems.filter((i) => i.courseKey === courseKey && i.approved);
      const topics = [...new Set(items.map((i) => i.topicKey))];
      // participation: most students practice, with a few who never do
      const nSessions =
        st.n === 2 ? 2 : Math.max(0, Math.round(r() * 3.2 * (0.5 + st.persist) - 0.2));
      const sectionId = st.section[courseKey]
        ? sid("section", courseKey, st.section[courseKey] as string)
        : null;
      for (let si = 0; si < nSessions; si++) {
        // topic: weighted toward weaker topics
        const weights = topics.map((t) =>
          Math.pow(1 - clamp(st.ability + (st.adj[t] ?? 0), 0.05, 0.95), 2),
        );
        const total = weights.reduce((s, w) => s + w, 0);
        let pickW = r() * total;
        let topic = topics[0] as string;
        for (const [i, t] of topics.entries()) {
          pickW -= weights[i] as number;
          if (pickW <= 0) {
            topic = t;
            break;
          }
        }
        const pool = items.filter((i) => i.topicKey === topic);
        const topicId = pool[0]?.topicId as string;
        const startMs =
          S.anchor.getTime() - (24 - ((si + r() * 0.9) / Math.max(1, nSessions)) * 23.5) * DAY_MS;
        const sessionKey = `${st.key}:${courseKey}:${si}`;
        const sessionId = sid("psess", sessionKey);
        const nItems = 3 + Math.floor(r() * 5);
        let d = clamp(Math.round(2 + (st.ability - 0.5) * 3), 1, 4);
        const used = new Set<string>();
        let t = startMs;
        let correctCount = 0;
        let served = 0;
        const evBase = {
          actorId: st.id,
          courseId,
          sectionId,
          condition: st.condition,
        };
        acc.events.add({
          ...evBase,
          name: "practice_started",
          key: `pstart:${sessionKey}`,
          at: clampAt(t),
          metadata: { practiceSessionId: sessionId, topicId },
        });
        let aiDone = false;
        for (let k = 0; k < nItems; k++) {
          const cands = pool
            .filter((i) => !used.has(i.id))
            .sort(
              (x, y) =>
                Math.abs(x.difficulty - d) - Math.abs(y.difficulty - d) || (x.id < y.id ? -1 : 1),
            );
          const item = cands[0];
          if (!item) break;
          used.add(item.id);
          served++;
          const skill = clamp(st.ability + (st.adj[topic] ?? 0) + 0.04 * si, 0.02, 0.98);
          const base = sigmoid(5 * (skill - (0.1 + 0.12 * item.difficulty)));
          const pc = item.def.type === "MULTIPLE_CHOICE" ? 0.25 + 0.75 * base : base;
          const correct = r() < pc;
          t += intBetween(r, 5, 25) * 1000;
          const shownAt = clampAt(t);
          acc.events.add({
            ...evBase,
            name: "practice_item_shown",
            key: `pshown:${sessionKey}:${k}`,
            at: shownAt,
            metadata: {
              practiceSessionId: sessionId,
              itemId: item.id,
              difficulty: item.difficulty,
              source: item.source,
            },
          });
          const think = intBetween(r, 20, item.def.type === "TRACE" ? 150 : 90) * 1000;
          t += think;
          const answeredAt = clampAt(t);
          const attemptId = sid("pat", sessionKey, k, 1);
          const hints = correct ? 0 : intBetween(r, 0, 2);
          const wantsExplain = !correct && r() < 0.4;
          const assisted = wantsExplain || hints > 0;
          const answer = correct
            ? (item.def.accepted?.[0] ?? item.def.answer)
            : wrongAnswer(item, r);
          acc.attempts.push({
            id: attemptId,
            sessionId,
            itemId: item.id,
            userId: st.id,
            answer,
            isCorrect: correct,
            score: correct ? 1 : 0,
            attemptNumber: 1,
            difficulty: item.difficulty,
            hintsUsed: hints,
            explanationRequested: wantsExplain,
            assisted,
            feedback: correct ? "Correct." : `Not quite. ${item.def.explanation}`,
            gradedBy: "AUTO",
            idempotencyKey: `seed:${attemptId}`,
            shownAt,
            answeredAt,
          });
          const answeredEvent = acc.events.add({
            ...evBase,
            name: "practice_answered",
            key: `pans:${attemptId}`,
            at: answeredAt,
            metadata: {
              practiceSessionId: sessionId,
              itemId: item.id,
              attemptId,
              isCorrect: correct,
              attemptNumber: 1,
              assisted,
            },
          });
          if (correct) correctCount++;
          const evCommon = {
            acc,
            st,
            courseKey,
            courseId,
            topicId: item.topicId,
            practiceItemId: item.id,
            difficulty: item.difficulty,
            condition: st.condition,
            sourceType: "PRACTICE" as const,
          };
          addEvidence({
            ...evCommon,
            key: `${attemptId}:success`,
            type: "PRACTICE_SUCCESS",
            sourceId: attemptId,
            sourceEventId: answeredEvent,
            value: correct ? (assisted ? 0.7 : 1) : 0,
            raw: { correct, hintsUsed: hints },
            weight: 0.6,
            assisted,
            attemptNumber: 1,
            at: new Date(answeredAt.getTime() + 500),
          });
          if (correct && !assisted && item.difficulty >= 3 && (st.adj[topic] ?? 0) < -0.08) {
            addEvidence({
              ...evCommon,
              key: `${attemptId}:transfer`,
              type: "TRANSFER",
              sourceId: attemptId,
              sourceEventId: answeredEvent,
              value: 1,
              raw: { difficulty: item.difficulty },
              weight: 0.8,
              attemptNumber: 1,
              at: new Date(answeredAt.getTime() + 800),
            });
          }
          if (!correct && item.def.misconception) {
            addObservation({
              acc,
              st,
              courseKey,
              courseId,
              misconceptionKey: item.def.misconception,
              key: `${attemptId}:${item.def.misconception}`,
              confidence: 0.55 + r() * 0.25,
              method: "RULE",
              at: new Date(answeredAt.getTime() + 1200),
              practiceAttemptId: attemptId,
              reviewStatus: "PENDING",
            });
          }
          if (wantsExplain) {
            acc.events.add({
              ...evBase,
              name: "explanation_requested",
              key: `pexpl:${attemptId}`,
              at: new Date(answeredAt.getTime() + 4000),
              metadata: { practiceSessionId: sessionId, itemId: item.id },
            });
            if (!aiDone && st.condition !== "CONTROL") {
              aiDone = true;
              const turns = PRACTICE_EXPLAIN.slice(0, 1 + Math.floor(r() * 2));
              const res = buildAiSession({
                acc,
                st,
                courseKey,
                courseId,
                mode: "PRACTICE",
                practiceSessionId: sessionId,
                topicKey: topic,
                turns,
                startMs: answeredAt.getTime() + 8000,
                r,
                key: `practice:${sessionKey}`,
              });
              t = Math.max(t, res.endMs);
            }
            // second attempt after the explanation
            const second = r() < 0.55;
            t += intBetween(r, 20, 60) * 1000;
            const a2 = sid("pat", sessionKey, k, 2);
            const a2At = clampAt(t);
            acc.attempts.push({
              id: a2,
              sessionId,
              itemId: item.id,
              userId: st.id,
              answer: second ? (item.def.accepted?.[0] ?? item.def.answer) : wrongAnswer(item, r),
              isCorrect: second,
              score: second ? 1 : 0,
              attemptNumber: 2,
              difficulty: item.difficulty,
              hintsUsed: hints,
              explanationRequested: true,
              assisted: true,
              feedback: second ? "Correct." : `Not quite. ${item.def.explanation}`,
              gradedBy: "AUTO",
              idempotencyKey: `seed:${a2}`,
              shownAt: answeredAt,
              answeredAt: a2At,
            });
            const e2 = acc.events.add({
              ...evBase,
              name: "practice_answered",
              key: `pans:${a2}`,
              at: a2At,
              metadata: {
                practiceSessionId: sessionId,
                itemId: item.id,
                attemptId: a2,
                isCorrect: second,
                attemptNumber: 2,
                assisted: true,
              },
            });
            addEvidence({
              ...evCommon,
              key: `${a2}:success`,
              type: "PRACTICE_SUCCESS",
              sourceId: a2,
              sourceEventId: e2,
              value: second ? 0.7 : 0,
              raw: { correct: second, afterExplanation: true },
              weight: 0.6,
              assisted: true,
              attemptNumber: 2,
              at: new Date(a2At.getTime() + 500),
            });
          }
          d = clamp(d + (correct ? 1 : -1), 1, 5);
          t += intBetween(r, 3, 12) * 1000;
        }
        const abandoned = r() < 0.1 && served >= 2;
        const endAt = clampAt(t + 5000);
        acc.practiceSessions.push({
          id: sessionId,
          userId: st.id,
          courseId,
          topicId,
          status: abandoned ? "ABANDONED" : "COMPLETED",
          currentDifficulty: d,
          itemsServed: served,
          correctCount,
          researchCondition: st.condition,
          startedAt: clampAt(startMs),
          endedAt: endAt,
        });
        if (!abandoned) {
          acc.events.add({
            ...evBase,
            name: "practice_completed",
            key: `pdone:${sessionKey}`,
            at: endAt,
            metadata: { practiceSessionId: sessionId, itemsServed: served, correctCount },
          });
        }
        void MIN_MS;
      }
    }
  }
}

export type { CourseKey };
