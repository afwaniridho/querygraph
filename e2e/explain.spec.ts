import { expect, test } from "@playwright/test";

test.describe("PostgreSQL EXPLAIN visualizer", () => {
	test("opens directly with first-run safety instructions", async ({ page }) => {
		await page.goto("/explain");
		await expect(page.getByTestId("explain-empty-state")).toBeVisible();
		await expect(page.getByText("EXPLAIN ANALYZE executes the statement.")).toBeVisible();
		await expect(page.getByText("processed locally")).toBeVisible();
	});

	test("navigates from Query Logic without losing its SQL", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".react-flow__node");
		await page.getByRole("link", { name: "Execution Plan" }).click();
		await expect(page).toHaveURL("/explain");
		await expect(page.getByText("Query Logic")).toBeVisible();
	});

	test("loads an analyzed example, renders nodes, details, and findings", async ({
		page,
	}) => {
		await page.goto("/explain");
		await page.getByTestId("plan-example-sort-spill").click();
		await expect(page.getByTestId("plan-status")).toContainText("EXPLAIN ANALYZE");
		await expect(page.getByTestId("plan-overview")).toBeVisible();
		await expect(page.locator(".qg-plan-node")).toHaveCount(2);
		await page.getByTestId("plan-finding-sort-spill").click();
		await expect(page.getByTestId("plan-details")).toContainText("Sort used disk");
		await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
	});

	test("accepts estimated plans and clears them", async ({ page }) => {
		await page.goto("/explain");
		await page.getByLabel("PostgreSQL EXPLAIN JSON").fill(
			JSON.stringify([
				{
					Plan: {
						"Node Type": "Seq Scan",
						"Relation Name": "items",
						"Plan Rows": 120,
						"Total Cost": 42,
					},
				},
			]),
		);
		await expect(page.getByTestId("plan-status")).toContainText("Estimated plan");
		await page.getByTestId("clear-plan").click();
		await expect(page.getByTestId("explain-empty-state")).toBeVisible();
	});

	test("shows friendly invalid-input feedback", async ({ page }) => {
		await page.goto("/explain");
		await page.getByLabel("PostgreSQL EXPLAIN JSON").fill("EXPLAIN SELECT 1");
		await expect(page.getByTestId("plan-error")).toContainText(
			"This does not appear to be PostgreSQL EXPLAIN JSON.",
		);
	});

	test("switches to MySQL with database-specific commands and examples", async ({
		page,
	}) => {
		await page.goto("/explain");
		await page.getByRole("button", { name: "MySQL" }).click();
		await expect(page.getByLabel("MySQL EXPLAIN")).toBeVisible();
		await expect(page.getByText("EXPLAIN FORMAT=JSON\nSELECT ...;")).toBeVisible();
		await expect(page.getByText("EXPLAIN (ANALYZE")).toHaveCount(0);
		await expect(page.getByTestId("plan-example-mysql-filesort")).toBeVisible();
		await expect(page.getByTestId("plan-example-sort-spill")).toHaveCount(0);
	});

	test("loads a MySQL example, renders nodes, details, and findings", async ({
		page,
	}) => {
		await page.goto("/explain");
		await page.getByRole("button", { name: "MySQL" }).click();
		await page.getByTestId("plan-example-mysql-full-scan-filtering").click();
		await expect(page.getByTestId("plan-status")).toContainText("MySQL");
		await expect(page.getByTestId("plan-overview")).toBeVisible();
		await expect(page.locator(".qg-plan-node")).toHaveCount(2);
		await page
			.getByTestId("plan-finding-mysql-no-possible-keys-filtered-scan")
			.click();
		await expect(page.getByTestId("plan-details")).toContainText(
			"No possible keys for filtered scan",
		);
		await expect(page.getByTestId("plan-details")).toContainText("Access path");
		await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
	});

	test("renders MySQL EXPLAIN ANALYZE TREE runtime plans", async ({ page }) => {
		await page.goto("/explain");
		await page.getByRole("button", { name: "MySQL" }).click();
		await page.getByLabel("MySQL EXPLAIN").fill(
			`-> Nested loop inner join  (cost=2.40 rows=2) (actual time=0.05..0.08 rows=2 loops=1)
    -> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.03 rows=4 loops=1)
    -> Index lookup on t2 using idx  (cost=0.30 rows=1) (actual time=0.01..0.01 rows=1 loops=4)`,
		);
		await expect(page.getByTestId("plan-status")).toContainText(
			"EXPLAIN ANALYZE TREE",
		);
		await expect(page.locator(".qg-plan-node")).toHaveCount(3);
		await page.getByTestId("plan-node-plan-0-0").click();
		await expect(page.getByTestId("plan-details")).toContainText("Runtime");
		await expect(page.getByTestId("plan-details")).toContainText(
			"Rows per loop",
		);
	});

	test("shows friendly MySQL invalid-input feedback and switches back to PostgreSQL", async ({
		page,
	}) => {
		await page.goto("/explain");
		await page.getByRole("button", { name: "MySQL" }).click();
		await page.getByLabel("MySQL EXPLAIN").fill("EXPLAIN SELECT 1");
		await expect(page.getByTestId("plan-error")).toContainText(
			"This does not appear to be MySQL EXPLAIN FORMAT=JSON output.",
		);
		await page.getByRole("button", { name: "PostgreSQL" }).click();
		await expect(page.getByLabel("PostgreSQL EXPLAIN JSON")).toBeVisible();
		await page.getByTestId("plan-example-sort-spill").click();
		await expect(page.getByTestId("plan-status")).toContainText("PostgreSQL");
	});

	test("supports mobile Input, Plan, and Findings navigation", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/explain");
		await page.getByRole("button", { name: "PostgreSQL" }).click();
		await page.getByTestId("plan-example-filtering-loss").click();
		await expect(page.getByTestId("plan-overview")).toBeVisible();
		await page.getByRole("button", { name: /findings/i }).click();
		await expect(page.getByTestId("plan-finding-large-filtering-loss")).toBeVisible();
		await page.getByTestId("plan-finding-large-filtering-loss").click();
		await expect(page.getByTestId("plan-details")).toBeVisible();
	});
});
