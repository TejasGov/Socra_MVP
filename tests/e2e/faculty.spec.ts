import { createDraftWithCopilot } from "./support/authoring";
import { assignmentIdByTitle, expect, test, USERS } from "./support/fixtures";

// "No responses yet" is the zero-denominator state (design audit #16).
const DENOMINATOR_OR_INSUFFICIENT = /\bof \d+|\d+\/\d+|n = \d+|Insufficient data|No responses yet/;

test.describe("faculty journey", () => {
  test("author with copilot, edit, preview, publish", async ({ signedIn }) => {
    test.setTimeout(180_000);
    const page = await signedIn(USERS.faculty);
    const title = `E2E Lists and loops ${Date.now()}`;

    const assignmentId = await createDraftWithCopilot(
      page,
      "A CSE 115 homework on building and filtering lists with loops and range bounds.",
      title,
    );
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Preview.
    await page.getByTestId("preview-link").click();
    await expect(page).toHaveURL(new RegExp(`/faculty/assignments/${assignmentId}/preview$`));
    await expect(page.getByTestId("preview-banner")).toBeVisible();

    // Publish with confirmation.
    await page.goto(`/faculty/assignments/${assignmentId}/edit`);
    await expect(page.getByTestId("publish-review")).toBeVisible({ timeout: 20_000 });
    const publish = page.getByTestId("publish-button");
    await expect(
      publish,
      "publish-button disabled: the publish review reported blocking issues for a copilot-generated draft",
    ).toBeEnabled();
    await publish.click();
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("close-assignment")).toBeVisible();
  });

  test("submissions page for a seeded assignment", async ({ signedIn }) => {
    const page = await signedIn(USERS.faculty);
    const id = await assignmentIdByTitle("HW4: Lists and loops");
    await page.goto(`/faculty/assignments/${id}/submissions`);
    await expect(
      page.getByRole("heading", { name: /Submissions: HW4: Lists and loops/ }),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Student submissions" })).toBeVisible();
  });

  test("dashboard metrics and question drilldown", async ({ signedIn }) => {
    const page = await signedIn(USERS.faculty);
    await page.goto("/faculty");
    const metrics = page.getByTestId("analytics-metric");
    await expect(metrics.first()).toBeVisible({ timeout: 30_000 });

    // Every metric shows a denominator or says there is not enough data.
    for (const t of await metrics.allInnerTexts()) expect(t).toMatch(DENOMINATOR_OR_INSUFFICIENT);

    await page.goto("/faculty/analytics");
    const link = page.getByTestId("question-drilldown-link").first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(page).toHaveURL(/\/faculty\/insights\/questions\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Socra interaction funnel" })).toBeVisible();
    const drill = page.getByTestId("analytics-metric");
    await expect(drill.first()).toBeVisible();
    const texts = await drill.allInnerTexts();
    expect(
      texts.some((t) => DENOMINATOR_OR_INSUFFICIENT.test(t)),
      "drilldown metrics should show denominators or Insufficient data",
    ).toBe(true);
  });
});
