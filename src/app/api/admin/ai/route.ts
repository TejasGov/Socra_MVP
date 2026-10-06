import { requireUser } from "@/server/auth/current-user";
import {
  budgetSchema,
  getAiAdminState,
  killSwitchSchema,
  modelConfigSchema,
  setAiKillSwitch,
  setCourseBudget,
  upsertModelConfiguration,
} from "@/server/domain/admin/ai";
import { assertSameOrigin, HttpError, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Never includes the API key; only "configured" / "not configured". */
export const GET = route(async () => {
  const user = await requireUser();
  return json(await getAiAdminState(user));
});

/** PUT ?section=model | budget | kill-switch */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const section = new URL(req.url).searchParams.get("section");
  if (section === "model") {
    const row = await upsertModelConfiguration(user, await parseJson(req, modelConfigSchema));
    return json({ id: row.id });
  }
  if (section === "budget") {
    const row = await setCourseBudget(user, await parseJson(req, budgetSchema));
    return json({ id: row.id });
  }
  if (section === "kill-switch") {
    return json(await setAiKillSwitch(user, await parseJson(req, killSwitchSchema)));
  }
  throw new HttpError(400, "unknown_section", "section must be model, budget or kill-switch");
});
