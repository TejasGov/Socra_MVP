import Link from "next/link";
import { DateText, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { auditQuerySchema, listAuditLog } from "@/server/domain/admin/audit-view";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePageUser("/admin/audit");
  const sp = await searchParams;
  const parsed = auditQuerySchema.safeParse({
    action: sp.action || undefined,
    actorEmail: sp.actorEmail || undefined,
    targetType: sp.targetType || undefined,
    courseId: sp.courseId || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    page: sp.page || undefined,
  });
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const log = await listAuditLog(user, query);

  const link = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
    p.set("page", String(page));
    return `/admin/audit?${p.toString()}`;
  };

  return (
    <div className="max-w-6xl">
      <PageHeader title="Audit log" meta={`${log.total} entries. The log is append-only.`} />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="mb-1 block font-medium">Action contains</span>
          <input
            name="action"
            list="audit-actions"
            defaultValue={sp.action ?? ""}
            className="border-border-input bg-surface h-8 w-52 rounded-sm border px-2"
          />
          <datalist id="audit-actions">
            {log.actions.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="mb-1 block font-medium">Actor email contains</span>
          <input
            name="actorEmail"
            defaultValue={sp.actorEmail ?? ""}
            className="border-border-input bg-surface h-8 w-52 rounded-sm border px-2"
          />
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

      {log.rows.length === 0 ? (
        <EmptyState>No audit entries match these filters.</EmptyState>
      ) : (
        <Table caption="Audit log entries">
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Target</TH>
              <TH>Reason</TH>
              <TH>Details</TH>
            </TR>
          </THead>
          <TBody>
            {log.rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <DateText date={r.createdAt} />
                </TD>
                <TD>{r.actorEmail ?? "System"}</TD>
                <TD className="text-code font-mono">{r.action}</TD>
                <TD>
                  {r.targetType}
                  {r.targetId ? (
                    <div className="text-fg-muted font-mono text-xs">{r.targetId}</div>
                  ) : null}
                </TD>
                <TD className="text-fg-muted max-w-60">{r.reason ?? ""}</TD>
                <TD>
                  <details>
                    <summary className="text-accent cursor-pointer">
                      View<span className="sr-only"> details for {r.action}</span>
                    </summary>
                    <pre className="bg-surface-2 text-code mt-1 max-w-md overflow-x-auto rounded-sm p-2 font-mono">
                      {JSON.stringify(r.metadata, null, 2)}
                    </pre>
                  </details>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <nav aria-label="Pagination" className="mt-4 flex items-center gap-4 text-sm">
        {log.page > 1 ? (
          <Link className="text-accent hover:underline" href={link(log.page - 1)}>
            Previous page
          </Link>
        ) : null}
        <span className="text-fg-muted">
          Page {log.page} of {log.pageCount}
        </span>
        {log.page < log.pageCount ? (
          <Link className="text-accent hover:underline" href={link(log.page + 1)}>
            Next page
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
