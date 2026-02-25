import { test, expect } from "./fixtures";

/**
 * Smoke tests — verify that key pages load without errors.
 * Each test navigates directly to a page and checks that the main content area renders.
 */

const pages = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "AI Copilot", path: "/dashboard/ai-copilot" },
  { name: "Data Hygiene Import", path: "/dashboard/data-hygiene/import" },
  { name: "Data Hygiene History", path: "/dashboard/data-hygiene/history" },
  { name: "Rules - Rule Sets", path: "/dashboard/rules/rule-sets" },
  { name: "Rules - Simulator", path: "/dashboard/rules/simulator" },
  { name: "Rules - Test Cases", path: "/dashboard/rules/test-cases" },
  { name: "Comp Cycles - Active", path: "/dashboard/comp-cycles/active" },
  {
    name: "Comp Cycles - Recommendations",
    path: "/dashboard/comp-cycles/recommendations",
  },
  {
    name: "Comp Cycles - Calibration",
    path: "/dashboard/comp-cycles/calibration",
  },
  { name: "Payroll - Runs", path: "/dashboard/payroll/runs" },
  { name: "Payroll - Anomalies", path: "/dashboard/payroll/anomalies" },
  {
    name: "Payroll - Reconciliation",
    path: "/dashboard/payroll/reconciliation",
  },
  { name: "Analytics - Total Rewards", path: "/dashboard/analytics/total-rewards" },
  { name: "Analytics - Pay Equity", path: "/dashboard/analytics/pay-equity" },
  { name: "Analytics - HR Dashboards", path: "/dashboard/analytics/hr-dashboards" },
  { name: "Analytics - Simulations", path: "/dashboard/analytics/simulations" },
  { name: "Reports", path: "/dashboard/reports" },
  { name: "Letters", path: "/dashboard/letters" },
  { name: "Compliance", path: "/dashboard/compliance" },
  { name: "Settings - Tenant", path: "/dashboard/settings/tenant" },
  { name: "Settings - Users", path: "/dashboard/settings/users" },
  { name: "Settings - Audit Log", path: "/dashboard/settings/audit-log" },
] as const;

test.describe("Page Smoke Tests", () => {
  for (const { name, path } of pages) {
    test(`${name} page loads successfully`, async ({ authedPage: page }) => {
      await page.goto(path);
      // Should stay on the target page (not redirect to login)
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      // Main content area should be visible
      await expect(page.locator("main")).toBeVisible();
      // No unhandled error overlay (Next.js error overlay has a specific structure)
      await expect(page.locator("nextjs-portal")).toHaveCount(0);
    });
  }
});

