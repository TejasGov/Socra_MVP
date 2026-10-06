"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Label, Select, StateBadge } from "@/components/ui";
import { apiJson } from "@/components/workspace/api";

export interface PracticeTopicDto {
  topicId: string;
  name: string;
  state: string | null;
  itemCount: number;
}

export interface PracticeCourseDto {
  id: string;
  code: string;
  title: string;
  topics: PracticeTopicDto[];
  /** Set when topics could not be loaded for this course. */
  topicsError: string | null;
}

const MIXED = "__mixed__";

export function PracticeStart({
  courses,
  initialCourseId,
  initialTopicId,
}: {
  courses: PracticeCourseDto[];
  initialCourseId?: string | null;
  initialTopicId?: string | null;
}) {
  const router = useRouter();
  const courseSelectId = useId();
  const topicGroupId = useId();
  const [courseId, setCourseId] = useState(
    courses.find((c) => c.id === initialCourseId)?.id ?? courses[0]?.id ?? "",
  );
  const course = courses.find((c) => c.id === courseId);
  const [topicId, setTopicId] = useState<string>(() => {
    const c = courses.find((x) => x.id === courseId);
    if (initialTopicId && c?.topics.some((t) => t.topicId === initialTopicId))
      return initialTopicId;
    return MIXED;
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { suggested, others } = useMemo(() => {
    const topics = course?.topics ?? [];
    return {
      suggested: topics.filter((t) => t.state === "NEEDS_REINFORCEMENT"),
      others: topics.filter((t) => t.state !== "NEEDS_REINFORCEMENT"),
    };
  }, [course]);

  const start = async () => {
    if (!courseId || starting) return;
    setStarting(true);
    setError(null);
    const res = await apiJson<{ sessionId: string }>("/api/practice/sessions", {
      method: "POST",
      body: { courseId, topicId: topicId === MIXED ? null : topicId },
    });
    if (res.ok && res.data.sessionId) {
      router.push(`/practice/${res.data.sessionId}`);
      return;
    }
    setStarting(false);
    setError(
      res.ok
        ? "The server did not return a session."
        : res.status === 0
          ? "Couldn't reach the server. Check your connection and start again."
          : res.error.message,
    );
  };

  if (courses.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        You are not enrolled in a course with practice yet. Courses you join will be listed here.
      </p>
    );
  }

  const topicRow = (t: PracticeTopicDto, isSuggested: boolean) => (
    <li key={t.topicId}>
      <label className="border-border hover:bg-surface-2 has-[:checked]:bg-accent-subtle flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          <input
            type="radio"
            name="practice-topic"
            value={t.topicId}
            checked={topicId === t.topicId}
            onChange={() => setTopicId(t.topicId)}
            className="accent-accent"
          />
          <span className="text-fg">{t.name}</span>
          {isSuggested ? (
            <span className="text-state-reinforce text-xs">Suggested: needs reinforcement</span>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          {!isSuggested ? <StateBadge state={t.state} /> : null}
          <span className="text-fg-subtle text-xs tabular-nums">
            {t.itemCount === 0
              ? "new questions generated"
              : `${t.itemCount} ${t.itemCount === 1 ? "question" : "questions"}`}
          </span>
        </span>
      </label>
    </li>
  );

  return (
    <div className="max-w-[720px] space-y-6">
      <div>
        <Label htmlFor={courseSelectId}>Course</Label>
        <Select
          id={courseSelectId}
          className="mt-1 max-w-sm"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setTopicId(MIXED);
          }}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}: {c.title}
            </option>
          ))}
        </Select>
      </div>

      <fieldset>
        <legend id={topicGroupId} className="text-fg text-sm font-medium">
          Topic
        </legend>
        <p className="text-fg-subtle mt-0.5 text-xs">
          Topics where your recent work needs reinforcement are listed first. Practice answers
          update your learning profile.
        </p>
        {course?.topicsError ? (
          <p role="alert" className="text-danger mt-2 text-sm">
            {course.topicsError}
          </p>
        ) : null}
        <ul
          className="border-border bg-surface mt-2 rounded-lg border"
          aria-labelledby={topicGroupId}
        >
          <li>
            <label className="border-border hover:bg-surface-2 has-[:checked]:bg-accent-subtle flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm">
              <input
                type="radio"
                name="practice-topic"
                value={MIXED}
                checked={topicId === MIXED}
                onChange={() => setTopicId(MIXED)}
                className="accent-accent"
              />
              <span className="text-fg">Let Socra choose</span>
              <span className="text-fg-subtle text-xs">
                starts with topics that need reinforcement
              </span>
            </label>
          </li>
          {suggested.map((t) => topicRow(t, true))}
          {others.map((t) => topicRow(t, false))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          data-testid="practice-start"
          onClick={() => void start()}
          loading={starting}
          loadingLabel="Starting practice…"
          disabled={!courseId}
        >
          Start practice
        </Button>
        <p className="text-fg-subtle text-xs">
          In practice mode Socra can explain answers fully. You can stop at any time.
        </p>
      </div>
      {error ? <ErrorState title="Couldn't start practice">{error}</ErrorState> : null}
    </div>
  );
}
