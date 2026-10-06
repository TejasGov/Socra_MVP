import { requireUser } from "@/server/auth/current-user";
import { getResearchExportDownload } from "@/server/domain/research/export";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const file = await getResearchExportDownload(user, id);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store",
    },
  });
});
