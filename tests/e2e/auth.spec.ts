import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "socra-dev-password";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("student signs in and lands on home", async ({ page }) => {
  await login(page, "student1@socra.local");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
});

test("faculty signs in and lands on the faculty overview", async ({ page }) => {
  await login(page, "faculty@socra.local");
  await expect(page).toHaveURL(/\/faculty$/);
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("student1@socra.local");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
});

test("student cannot open the admin area", async ({ page }) => {
  await login(page, "student1@socra.local");
  await page.waitForURL(/\/home$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/forbidden$/);
});

test("signed-out users are redirected to login", async ({ page }) => {
  await page.goto("/faculty");
  await expect(page).toHaveURL(/\/login\?next=/);
});
