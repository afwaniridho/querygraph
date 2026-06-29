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

	test("supports mobile Input, Plan, and Findings navigation", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/explain");
		await page.getByTestId("plan-example-filtering-loss").click();
		await expect(page.getByTestId("plan-overview")).toBeVisible();
		await page.getByRole("button", { name: /findings/i }).click();
		await expect(page.getByTestId("plan-finding-large-filtering-loss")).toBeVisible();
		await page.getByTestId("plan-finding-large-filtering-loss").click();
		await expect(page.getByTestId("plan-details")).toBeVisible();
	});
});
