import { test, expect } from "./fixtures";

test.describe("Sidebar Navigation", () => {
  test("dashboard page loads with sidebar visible", async ({
    authedPage: page,
  }) => {
    // Sidebar should be visible on desktop viewport (Playwright default is 1280x720)
    await expect(page.locator("nav[aria-label='Main navigation']")).toBeVisible();
  });

  test("sidebar contains Dashboard link", async ({ authedPage: page }) => {
    await expect(
      page.getByRole("link", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("sidebar contains AI Copilot link", async ({ authedPage: page }) => {
    await expect(
      page.getByRole("link", { name: "AI Copilot" })
    ).toBeVisible();
  });

  test("can navigate to Data Hygiene > Import Files", async ({
    authedPage: page,
  }) => {
    // Expand the Data Hygiene group
    await page
      .getByRole("button", { name: "Data Hygiene navigation group" })
      .click();
    await page.getByRole("link", { name: "Import Files" }).click();
    await expect(page).toHaveURL(/\/dashboard\/data-hygiene\/import/);
  });

  test("can navigate to Rules > Rules Copilot", async ({
    authedPage: page,
  }) => {
    // Expand the AI Features group
    await page
      .getByRole("button", { name: "AI Features navigation group" })
      .click();
    await page.getByRole("link", { name: "Rules Copilot" }).click();
    await expect(page).toHaveURL(/\/dashboard\/rules\/rule-sets/);
  });

  test("can navigate to Comp Cycles > Active Cycles", async ({
    authedPage: page,
  }) => {
    await page
      .getByRole("button", { name: "Comp Cycles navigation group" })
      .click();
    await page.getByRole("link", { name: "Active Cycles" }).click();
    await expect(page).toHaveURL(/\/dashboard\/comp-cycles\/active/);
  });

  test("can navigate to Payroll > Payroll Runs", async ({
    authedPage: page,
  }) => {
    await page
      .getByRole("button", { name: "Payroll Guard navigation group" })
      .click();
    await page.getByRole("link", { name: "Payroll Runs" }).click();
    await expect(page).toHaveURL(/\/dashboard\/payroll\/runs/);
  });

  test("can navigate to Settings > Tenant Settings", async ({
    authedPage: page,
  }) => {
    await page
      .getByRole("button", { name: "Settings navigation group" })
      .click();
    await page.getByRole("link", { name: "Tenant Settings" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/tenant/);
  });

  test("can navigate to Analytics > Total Rewards", async ({
    authedPage: page,
  }) => {
    await page
      .getByRole("button", { name: "Analytics navigation group" })
      .click();
    await page.getByRole("link", { name: "Total Rewards" }).click();
    await expect(page).toHaveURL(/\/dashboard\/analytics\/total-rewards/);
  });
});

