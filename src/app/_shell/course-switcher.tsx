"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Faculty course switcher. Writes `?courseId=` on the current faculty page; faculty pages read
 * `searchParams.courseId` and fall back to the first course they teach.
 */
export function CourseSwitcher({
  courses,
}: {
  courses: Array<{ id: string; code: string; title: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/faculty";
  const params = useSearchParams();
  const current = params.get("courseId") ?? courses[0]?.id ?? "";
  if (courses.length === 0) return null;
  if (courses.length === 1) {
    const c = courses[0]!;
    return (
      <p className="px-2 text-sm">
        <span className="font-medium">{c.code}</span>{" "}
        <span className="text-fg-muted">{c.title}</span>
      </p>
    );
  }
  return (
    <div className="px-2">
      <label htmlFor="shell-course" className="mb-1 block text-xs text-fg-subtle">
        Course
      </label>
      <select
        id="shell-course"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("courseId", e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="h-8 w-full rounded-sm border border-border-input bg-surface px-2 text-sm text-fg"
      >
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code}
          </option>
        ))}
      </select>
    </div>
  );
}
