import { expect, type Page } from "@playwright/test";
import { dbQuery } from "./fixtures";

/**
 * Fill the new-assignment form with the copilot, set a title, and save the draft.
 *
 * Known app bug (see report): the copilot can return topic slugs that do not exist in the course
 * (e.g. "loops"); POST /api/assignments then rejects the draft with 400 "Unknown topic tags".
 * To keep exercising everything downstream, this helper strips unknown topic keys from the save
 * request and records a SOFT failure, so the test is still reported as failed for the real bug.
 */
export async function createDraftWithCopilot(
  page: Page,
  prompt: string,
  title: string,
  opts: { referenceSolution?: string } = {},
) {
  const known = new Set(
    (await dbQuery<{ key: string }>(`select key from "Topic"`)).map((r) => r.key),
  );
  const stripped: string[] = [];
  const clean = (keys: unknown) =>
    Array.isArray(keys)
      ? keys.filter((k) => {
          if (typeof k === "string" && !known.has(k)) {
            stripped.push(k);
            return false;
          }
          return true;
        })
      : keys;

  await page.route("**/api/assignments", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = req.postDataJSON() as {
      topicKeys?: unknown;
      questions?: Array<{ topicKeys?: unknown }>;
    };
    body.topicKeys = clean(body.topicKeys);
    for (const q of body.questions ?? []) q.topicKeys = clean(q.topicKeys);
    return route.continue({ postData: JSON.stringify(body) });
  });

  await page.goto("/faculty/assignments/new");
  await page.getByTestId("copilot-prompt").fill(prompt);
  await page.getByTestId("copilot-generate").click();
  await expect(page.getByTestId("copilot-done")).toBeVisible({ timeout: 45_000 });
  const titleInput = page.locator("#title");
  await expect(titleInput).not.toHaveValue("");
  await expect(page.locator("#description")).not.toHaveValue("");
  await titleInput.fill(title);
  if (opts.referenceSolution) {
    // The copilot never writes a reference solution; review mode needs one to explain.
    const refs = page.getByLabel("Reference solution");
    for (let i = 0; i < (await refs.count()); i++) await refs.nth(i).fill(opts.referenceSolution);
  }
  await page.getByTestId("save-draft").click();
  await page.waitForURL(/\/faculty\/assignments\/[^/]+\/edit$/, { timeout: 30_000 });
  await page.unroute("**/api/assignments");

  expect
    .soft(
      stripped,
      "APP BUG: copilot suggested topic tags that do not exist in the course; saving the draft is rejected with 'Unknown topic tags' (authoring-ai/index.ts adds unmatched slugs verbatim)",
    )
    .toEqual([]);
  return page.url().match(/assignments\/([^/]+)\/edit/)![1]!;
}
