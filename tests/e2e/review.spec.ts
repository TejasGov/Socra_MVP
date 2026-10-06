import type { Page } from "@playwright/test";
import { createDraftWithCopilot } from "./support/authoring";
import { assignmentIdByTitle, dbQuery, expect, test, USERS } from "./support/fixtures";

const STREAM_TIMEOUT = 30_000;

async function expectReviewModeWithCode(student: Page) {
  const banner = student.getByTestId("mode-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Review mode");
  await expect(banner).toHaveAttribute("data-mode", "review");

  await student
    .locator('[data-testid="socra-input"]:visible')
    .first()
    .fill("explain the full solution");
  await student.locator('[data-testid="socra-send"]:visible').first().click();
  const reply = student
    .locator('[data-testid="socra-message"][data-role="assistant"]:visible')
    .last();
  await expect(reply).toBeVisible({ timeout: STREAM_TIMEOUT });
  await expect(reply).not.toHaveAttribute("aria-busy", "true", { timeout: STREAM_TIMEOUT });
  // A full-solution reply carries code: a code block or recognisable Python.
  await expect(reply.locator("pre, code").first()).toBeVisible({ timeout: 5_000 });
  expect(await reply.innerText()).toMatch(/def |return |\bfor \w+ in\b/);
}

test.describe("post-assessment review", () => {
  test("seeded closed assignment with released solutions opens in review mode", async ({
    signedIn,
  }) => {
    test.setTimeout(120_000);
    const hw3Id = await assignmentIdByTitle("HW3: Recursion");
    const [row] = await dbQuery<{ state: string; solutionsReleased: boolean; courseId: string }>(
      `select state::text as state, "solutionsReleased", "courseId" from "Assignment" where id = $1`,
      [hw3Id],
    );
    expect(row?.state).toBe("CLOSED");
    expect(row?.solutionsReleased).toBe(true);

    const student = await signedIn(USERS.student);
    await student.goto(`/courses/${row!.courseId}`);
    await student
      .locator("#main")
      .getByRole("link", { name: /HW3: Recursion/ })
      .click();
    await expect(student).toHaveURL(/\/courses\/[^/]+\/assignments\/[^/]+$/);
    await expectReviewModeWithCode(student);
  });

  test("faculty closes and releases an assignment, then a student reviews it", async ({
    signedIn,
  }) => {
    test.setTimeout(240_000);
    const faculty = await signedIn(USERS.faculty);
    const title = `E2E Review ${Date.now()}`;

    // Create and publish a throwaway assignment through the real UI.
    await createDraftWithCopilot(
      faculty,
      "A CSE 115 homework on recursion base cases, for the review-mode E2E.",
      title,
      {
        referenceSolution:
          "def solve(n):\n    if n <= 0:\n        return []\n    return [n] + solve(n - 1)\n",
      },
    );
    await expect(faculty.getByTestId("publish-review")).toBeVisible({ timeout: 20_000 });
    await expect(faculty.getByTestId("publish-button")).toBeEnabled();
    await faculty.getByTestId("publish-button").click();
    await faculty.getByTestId("publish-confirm").click();
    await expect(faculty.getByTestId("close-assignment")).toBeVisible({ timeout: 30_000 });

    // Close, then release solutions (a separate confirmed action).
    await faculty.getByTestId("close-assignment").click();
    await faculty.getByTestId("close-confirm").click();
    await expect(faculty.getByTestId("solutions-status")).toBeVisible({ timeout: 30_000 });
    const release = faculty.getByTestId("release-solutions");
    if (await release.isVisible()) {
      await release.click();
      await faculty.getByTestId("release-confirm").click();
    }
    await expect(faculty.getByTestId("solutions-status")).toContainText("Solutions are released", {
      timeout: 30_000,
    });

    // Student opens it in review mode.
    const [row] = await dbQuery<{ courseId: string }>(
      `select "courseId" from "Assignment" where title = $1`,
      [title],
    );
    const student = await signedIn(USERS.student);
    await student.goto(`/courses/${row!.courseId}`);
    await student.locator("#main").getByRole("link", { name: title }).click();
    await expect(student).toHaveURL(/\/courses\/[^/]+\/assignments\/[^/]+$/);
    await expectReviewModeWithCode(student);
  });
});
