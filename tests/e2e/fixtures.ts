import { test as base, expect, type Page } from "@playwright/test";

/** Demo credentials used for E2E tests. */
const TEST_USER = {
  email: "admin@compport.com",
  password: "Admin123!@#",
};

/**
 * Logs in via the UI and waits for the dashboard redirect.
 * Reusable helper that can be called from any test.
 */
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Extended Playwright test fixture that provides an already-authenticated page.
 *
 * Usage:
 *   import { test, expect } from "./fixtures";
 *   test("my test", async ({ authedPage }) => { ... });
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };

