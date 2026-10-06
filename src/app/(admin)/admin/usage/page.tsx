import { EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getUsage, usageQuerySchema } from "@/server/domain/admin/usage";
import { listCourses } from "@/server/domain/admin/courses";

export const metadata = { title: "AI usage" };
export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");

const MODE_LABEL: Record<string, string> = {
  PROTECTED_ASSESSMENT: "Protected",
  PRACTICE: "Practice",
  POST_ASSESSMENT_REVIEW: "Review",
  FACULTY_AUTHORING: "Faculty authoring",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePageUser("/admin/usage");
  const sp = await searchParams;
  const parsed = usageQuerySchema.safeParse({
    courseId: sp.courseId || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  });
  const query = parsed.success ? parsed.data : usageQuerySchema.parse({});
  const [usage, courses] = await Promise.all([getUsage(user, query), listCourses(user)]);
  const t = usage.totals;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="AI usage"
        meta={`${usage.from.toISOString().slice(0, 10)} to ${usage.to.toISOString().slice(0, 10)} (UTC), grouped by day, course, mode and model`}
      />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="mb-1 block font-medium">Course</span>
          <select
            name="courseId"
            defaultValue={sp.courseId ?? ""}
            className="border-border-input bg-surface h-8 rounded-sm border px-2"
          >
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block font-medium">From</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="border-border-input bg-surface h-8 rounded-sm border px-2"
          />
        </label>
        <label>
          <span className="mb-1 block font-medium">Until</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="border-border-input bg-surface h-8 rounded-sm border px-2"
          />
        </label>
        <button
          type="submit"
          className="border-border-strong bg-surface hover:bg-surface-2 h-8 rounded-md border px-3"
        >
          Apply filters
        </button>
      </form>

      {usage.rows.length === 0 ? (
        <EmptyState>No AI requests in this range.</EmptyState>
      ) : (
        <Table caption="AI usage by day, course, mode and model">
          <THead>
            <TR>
              <TH>Day</TH>
              <TH>Course</TH>
              <TH>Mode</TH>
              <TH>Model</TH>
              <TH numeric>Requests</TH>
              <TH numeric>Input tokens</TH>
              <TH numeric>Cached tokens</TH>
              <TH numeric>Output tokens</TH>
              <TH numeric>Cost (USD)</TH>
              <TH numeric>Failure rate</TH>
              <TH numeric>p95 latency</TH>
            </TR>
          </THead>
          <TBody>
            {usage.rows.map((r, i) => (
              <TR key={`${r.day}-${r.courseId}-${r.mode}-${r.model}-${i}`}>
                <TD>{r.day}</TD>
                <TD>{r.courseCode ?? "None"}</TD>
                <TD>{MODE_LABEL[r.mode] ?? r.mode}</TD>
                <TD className="text-code font-mono">{r.model}</TD>
                <TD numeric>{nf.format(r.requests)}</TD>
                <TD numeric>{nf.format(r.inputTokens)}</TD>
                <TD numeric>{nf.format(r.cachedTokens)}</TD>
                <TD numeric>{nf.format(r.outputTokens)}</TD>
                <TD numeric>{r.costUsd.toFixed(4)}</TD>
                <TD numeric>
                  {r.failureRate === null
                    ? "n/a"
                    : `${(r.failureRate * 100).toFixed(1)}% (${r.failures})`}
                </TD>
                <TD numeric>
                  {r.p95LatencyMs === null ? "n/a" : `${nf.format(r.p95LatencyMs)} ms`}
                </TD>
              </TR>
            ))}
          </TBody>
          <tfoot>
            <TR>
              <TH scope="row" colSpan={4}>
                Total of rows shown
              </TH>
              <TD numeric>{nf.format(t.requests)}</TD>
              <TD numeric>{nf.format(t.inputTokens)}</TD>
              <TD numeric>{nf.format(t.cachedTokens)}</TD>
              <TD numeric>{nf.format(t.outputTokens)}</TD>
              <TD numeric>{t.costUsd.toFixed(4)}</TD>
              <TD numeric>
                {t.requests > 0 ? `${((t.failures / t.requests) * 100).toFixed(1)}%` : "n/a"}
              </TD>
              <TD numeric>n/a</TD>
            </TR>
          </tfoot>
        </Table>
      )}
      <p className="text-fg-subtle mt-2 text-xs">
        Failure means status FAILED. p95 latency is computed per group from completed requests. Up
        to {query.limit} groups are shown.
      </p>
    </div>
  );
}
