import { dbQuery, expect, test, USERS } from "./support/fixtures";

/**
 * Copilot quiz end to end: faculty generate a QUIZ with the copilot, save and publish it; the E2E student
 * answers a multiple-choice question and submits, and the answer is graded deterministically (FINAL).
 * The title starts with "E2E" so the global teardown archives it.
 */
test.describe("copilot quiz", () => {
  test("generate, publish, answer, submit, auto-grade", async ({ signedIn }) => {
    test.setTimeout(240_000);
    const faculty = await signedIn(USERS.faculty);
    const title = `E2E Copilot quiz ${Date.now()}`;

    // Only keep topic tags the course knows (the copilot may suggest broader slugs).
    const known = new Set(
      (await dbQuery<{ key: string }>(`select key from "Topic"`)).map((r) => r.key),
    );
    await faculty.route("**/api/assignments", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      const body = req.postDataJSON() as {
        topicKeys?: string[];
        questions?: Array<{ topicKeys?: string[] }>;
      };
      body.topicKeys = (body.topicKeys ?? []).filter((k) => known.has(k));
      for (const q of body.questions ?? []) q.topicKeys = (q.topicKeys ?? []).filter((k) => known.has(k));
      return route.continue({ postData: JSON.stringify(body) });
    });

    await faculty.goto("/faculty/assignments/new");
    await faculty.locator("#format").selectOption("QUIZ");
    await faculty
      .getByTestId("copilot-prompt")
      .fill("A short CSE 115 quiz on recursion base cases and tracing the call stack.");
    await faculty.getByTestId("copilot-generate").click();
    await expect(faculty.getByTestId("copilot-done")).toBeVisible({ timeout: 45_000 });

    // At least four questions, with multiple-choice options filled in and a correct choice marked.
    const questions = faculty.getByRole("heading", { level: 3, name: /^Question \d+/ });
    await expect(questions.nth(3)).toBeVisible();
    expect(await questions.count()).toBeGreaterThanOrEqual(4);
    const choiceEditors = faculty.getByTestId("choices-editor");
    expect(await choiceEditors.count()).toBeGreaterThanOrEqual(2);
    const firstChoices = choiceEditors.first().getByTestId("choice-text");
    await expect(firstChoices).toHaveCount(4);
    for (const v of await firstChoices.evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value),
    ))
      expect(v.trim()).not.toBe("");
    await expect(choiceEditors.first().getByRole("radio", { checked: true })).toHaveCount(1);
    // Code-only fields are hidden for quiz questions.
    await expect(faculty.getByText("Starter code", { exact: true })).toHaveCount(0);
    await expect(faculty.getByTestId("accepted-answers").first()).not.toHaveValue("");

    await faculty.locator("#title").fill(title);
    await faculty.getByTestId("save-draft").click();
    await faculty.waitForURL(/\/faculty\/assignments\/[^/]+\/edit$/, { timeout: 30_000 });
    await faculty.unroute("**/api/assignments");
    const assignmentId = faculty.url().match(/assignments\/([^/]+)\/edit/)![1]!;

    // Stored exactly like the seeded quiz: [{ id, text }] choices and { correct } keys.
    const stored = await dbQuery<{ type: string; choices: unknown; answerKey: unknown }>(
      `select qv.type, qv.choices, qv."answerKey" from "Question" q
         join "QuestionVersion" qv on qv.id = q."currentVersionId"
        where q."assignmentId" = $1 order by q."order"`,
      [assignmentId],
    );
    const mc = stored.filter((r) => r.type === "MULTIPLE_CHOICE");
    expect(mc.length).toBeGreaterThanOrEqual(2);
    for (const r of mc) {
      const choices = r.choices as Array<{ id: string; text: string }>;
      expect(choices.length).toBe(4);
      expect(choices.map((c) => c.id)).toContain((r.answerKey as { correct: string }).correct);
    }
    expect(stored.some((r) => r.type === "SHORT_ANSWER")).toBe(true);

    // Publish.
    await expect(faculty.getByTestId("publish-review")).toBeVisible({ timeout: 20_000 });
    const publish = faculty.getByTestId("publish-button");
    await expect(publish, "publish review reported blocking issues for the quiz").toBeEnabled();
    await publish.click();
    await faculty.getByTestId("publish-confirm").click();
    await expect(faculty.getByText("Published", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Student answers the first multiple-choice question and submits.
    const [{ courseId } = { courseId: "" }] = await dbQuery<{ courseId: string }>(
      `select "courseId" from "Assignment" where id = $1`,
      [assignmentId],
    );
    const student = await signedIn(USERS.student);
    await student.goto(`/courses/${courseId}/assignments/${assignmentId}`);
    await expect(student.getByTestId("mode-banner")).toBeVisible({ timeout: 20_000 });
    const radios = student.locator('[data-testid="editor"]:visible input[type="radio"]');
    await expect(radios).toHaveCount(4, { timeout: 20_000 });
    const firstMc = mc[0]!;
    const correctId = (firstMc.answerKey as { correct: string }).correct;
    await student
      .locator(`[data-testid="editor"]:visible input[type="radio"][value="${correctId}"]`)
      .check();
    await expect(student.getByTestId("save-status")).toHaveText(/^Saved/, { timeout: 20_000 });

    // Answer the code-trace question (question 3) with an accepted spelling of its output.
    const trace = stored[2]!;
    expect(trace.type).toBe("SHORT_ANSWER");
    const traceAnswer = (trace.answerKey as { accepted: string[] }).accepted[0]!;
    await student.getByRole("button", { name: "Question 3", exact: true }).first().click();
    await student.locator('[data-testid="editor"]:visible textarea').fill(traceAnswer);
    await expect(student.getByTestId("save-status")).toHaveText(/^Saved/, { timeout: 20_000 });

    const submit = student.getByTestId("submit-button");
    await expect(submit).toBeEnabled();
    await submit.click();
    await student.getByTestId("submit-confirm").click();
    await expect(student.getByTestId("submission-confirmation")).toBeVisible({ timeout: 30_000 });

    // The answered multiple-choice question is graded against the key immediately.
    const grades = await dbQuery<{ status: string; finalScore: number | null; points: number }>(
      `select g.status, g."finalScore", qv.points from "Submission" s
         join "SubmissionAnswer" a on a."submissionId" = s.id
         join "QuestionVersion" qv on qv.id = a."questionVersionId"
         join "Grade" g on g."submissionId" = s.id and g."scopeKey" = a."questionId"
         join "User" u on u.id = s."userId"
        where s."assignmentId" = $1 and u.email = $2 and a.content = $3 and qv.type = 'MULTIPLE_CHOICE'`,
      [assignmentId, USERS.student, correctId],
    );
    expect(grades.length).toBeGreaterThanOrEqual(1);
    expect(grades[0]!.status).toBe("FINAL");
    expect(grades[0]!.finalScore).toBe(grades[0]!.points);

    // Every keyed question is FINAL right away (unanswered ones score 0); the written one waits for staff.
    const all = await dbQuery<{ type: string; status: string; finalScore: number | null; content: string }>(
      `select qv.type::text as type, g.status::text as status, g."finalScore", a.content
         from "Submission" s
         join "SubmissionAnswer" a on a."submissionId" = s.id
         join "QuestionVersion" qv on qv.id = a."questionVersionId"
         join "Grade" g on g."submissionId" = s.id and g."scopeKey" = a."questionId"
         join "User" u on u.id = s."userId"
        where s."assignmentId" = $1 and u.email = $2`,
      [assignmentId, USERS.student],
    );
    for (const g of all) expect(g.status).toBe(g.type === "ESSAY" ? "SUGGESTED" : "FINAL");
    const traced = all.find((g) => g.content === traceAnswer && g.type === "SHORT_ANSWER");
    expect(traced?.finalScore, "trace answer should earn full points").toBeGreaterThan(0);

    // Close and release solutions: the student sees the correct answer and the explanation in review.
    await faculty.goto(`/faculty/assignments/${assignmentId}/edit`);
    await faculty.getByTestId("close-assignment").click();
    await faculty.getByTestId("close-confirm").click();
    await expect(faculty.getByTestId("release-solutions")).toBeVisible({ timeout: 30_000 });
    await faculty.getByTestId("release-solutions").click();
    await faculty.getByTestId("release-confirm").click();
    await expect(faculty.getByTestId("solutions-status")).toContainText("Solutions are released", {
      timeout: 30_000,
    });

    await student.goto(`/courses/${courseId}/assignments/${assignmentId}`);
    const review = student.locator('[data-testid="answer-review"]:visible');
    await expect(review).toContainText("Correct answer:", { timeout: 20_000 });
    await expect(review).toContainText(/\w{20,}|\w+ \w+ \w+ \w+/);
  });
});
