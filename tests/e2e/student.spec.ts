import type { Locator, Page } from "@playwright/test";
import { assignmentIdByTitle, dbQuery, expect, test, USERS } from "./support/fixtures";

const STREAM_TIMEOUT = 30_000;
const RUN_TIMEOUT = 30_000;

/** Prefer student1; fall back to a student who still has HW4 attempts left so reruns stay green. */
async function studentWithAttemptsLeft(assignmentId: string): Promise<string> {
  const rows = await dbQuery<{ email: string }>(
    `select u.email
       from "User" u
       join "CourseMembership" m on m."userId" = u.id and m.status = 'ACTIVE' and m.role = 'STUDENT'
       join "Assignment" a on a.id = $1 and a."courseId" = m."courseId"
      where u.email like 'student%@socra.local'
        and (a."attemptLimit" is null
             or (select count(*) from "Submission" s where s."userId" = u.id and s."assignmentId" = a.id) < a."attemptLimit")
      order by (u.email = $2) desc, u.email asc
      limit 1`,
    [assignmentId, USERS.student],
  );
  return rows[0]?.email ?? USERS.student;
}

/** Replace the contents of a visible CodeMirror editor without fighting auto-close/auto-indent. */
async function replaceEditorText(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
}

test.describe("student journey", () => {
  test("login, edit, run, ask Socra, submit, profile, practice", async ({ signedIn }) => {
    test.setTimeout(240_000);
    const hw4Id = await assignmentIdByTitle("HW4: Lists and loops");
    const email = await studentWithAttemptsLeft(hw4Id);
    const page = await signedIn(email);

    // Open the course, then the HW4 coding assignment.
    await page.goto("/courses");
    await page.locator("#main").getByRole("link", { name: "CSE 115", exact: true }).click();
    await expect(page).toHaveURL(/\/courses\/[^/]+$/);
    await page.locator("#main").getByRole("link", { name: /HW4: Lists and loops/ }).click();
    await expect(page).toHaveURL(/\/courses\/[^/]+\/assignments\/[^/]+$/);
    await expect(page.getByTestId("mode-banner")).toBeVisible();

    // Edit code and wait for the autosave indicator.
    const editor = page.locator('[data-testid="editor"]:visible .cm-content').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    const marker = `E2E_OK_${Date.now()}`;
    await replaceEditorText(page, editor, `print("${marker}")\n`);
    await expect(page.getByTestId("save-status")).toHaveText(/^Saved/, { timeout: 20_000 });

    // Run: real stdout, or the honest unavailable message when the runner is down.
    await page.locator('[data-testid="run-button"]:visible').first().click();
    const output = page.locator('[data-testid="console-output"]:visible').first();
    await expect(output).toContainText(new RegExp(`${marker}|runner is unavailable`, "i"), {
      timeout: RUN_TIMEOUT,
    });
    const outText = (await output.innerText()).toLowerCase();
    if (outText.includes("runner is unavailable")) {
      test.info().annotations.push({
        type: "runner",
        description: "Runner unavailable in this environment; asserted the honest message.",
      });
      await expect(output).not.toContainText(marker);
    } else {
      await expect(output).toContainText(marker);
    }

    // Ask Socra.
    await page.locator('[data-testid="socra-input"]:visible').first().fill("why does my loop fail?");
    await page.locator('[data-testid="socra-send"]:visible').first().click();
    const reply = page.locator('[data-testid="socra-message"][data-role="assistant"]:visible').first();
    await expect(reply).toBeVisible({ timeout: STREAM_TIMEOUT });
    await expect(reply).not.toHaveAttribute("aria-busy", "true", { timeout: STREAM_TIMEOUT });
    await expect(reply).toHaveText(/\S{3,}/);

    // Submit through the confirmation dialog.
    const submit = page.getByTestId("submit-button");
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.getByTestId("submit-confirm").click();
    await expect(page.getByTestId("submission-confirmation")).toBeVisible({ timeout: 30_000 });

    // Learning profile.
    await page.goto("/profile");
    await expect(page.getByTestId("profile-topic-row").first()).toBeVisible({ timeout: 20_000 });

    // Practice: start, answer, get feedback.
    await page.goto("/practice");
    await page.getByTestId("practice-start").click();
    await expect(page).toHaveURL(/\/practice\/[^/]+$/, { timeout: 30_000 });
    const answer = page.getByTestId("practice-answer").first();
    await expect(answer).toBeVisible({ timeout: 30_000 });
    const tag = await answer.evaluate((el) => el.tagName.toLowerCase());
    const type = await answer.getAttribute("type");
    if (tag === "input" && type === "radio") {
      await answer.check();
    } else if (tag === "textarea") {
      await answer.fill("Answer from the E2E run");
    } else {
      const cm = answer.locator(".cm-content");
      await replaceEditorText(page, cm, "pass\n");
    }
    await page.getByTestId("practice-submit").click();
    await expect(page.getByTestId("practice-feedback")).toBeVisible({ timeout: STREAM_TIMEOUT });
  });
});
