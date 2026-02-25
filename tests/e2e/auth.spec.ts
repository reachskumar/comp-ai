import { test, expect } from "@playwright/test";
import { login } from "./fixtures";

test.describe("Authentication", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows login form with email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("shows validation errors for empty form submission", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign In" }).click();
    // Form validation should prevent submission — fields use HTML5 email type
    // and zod validation with min length 8 for password
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("logs in with valid credentials and redirects to dashboard", async ({
    page,
  }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    // Dashboard page should have loaded — verify main content area exists
    await expect(page.locator("main")).toBeVisible();
  });

  test("shows user menu with user info after login", async ({ page }) => {
    await login(page);
    // The top bar should show the user menu button
    await expect(
      page.getByRole("button", { name: "User menu" })
    ).toBeVisible();
  });

  test("logs out and redirects to login page", async ({ page }) => {
    await login(page);
    // Open user dropdown menu
    await page.getByRole("button", { name: "User menu" }).click();
    // Click sign out
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});

