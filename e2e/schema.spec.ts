import { expect, test } from "@playwright/test";

test.describe("Schema DDL access paths", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".react-flow__node", { timeout: 15000 });
	});

	test("schema toggle reveals and hides the DDL editor", async ({ page }) => {
		const toggle = page.locator("button", { hasText: "Schema" });
		await expect(toggle).toHaveAttribute("data-on", "false");

		await toggle.click();
		await expect(page.locator("text=Schema DDL — optional")).toBeVisible();
		await expect(toggle).toHaveAttribute("data-on", "true");

		await toggle.click();
		await expect(page.locator("text=Schema DDL — optional")).toBeHidden();
	});

	test("entering DDL annotates a table node with an access chip", async ({
		page,
	}) => {
		const editor = page.locator(".monaco-editor");
		await editor.click();
		await page.keyboard.press(
			process.platform === "darwin" ? "Meta+A" : "Control+A",
		);
		await page.waitForTimeout(50);
		await page.keyboard.type("SELECT * FROM customers WHERE id = 1;", {
			delay: 2,
		});
		await page.waitForTimeout(500);

		await page.locator("button", { hasText: "Schema" }).click();
		const ddl = page.getByLabel("Schema DDL");
		await ddl.click();
		await ddl.fill(
			"CREATE TABLE customers (id int PRIMARY KEY, email varchar(255));",
		);
		await page.waitForTimeout(600);

		await expect(page.locator("text=PK lookup").first()).toBeVisible();
		await expect(
			page.locator("button", { hasText: "Schema" }),
		).toContainText("table");
	});

	test("DDL persists across reload", async ({ page }) => {
		await page.locator("button", { hasText: "Schema" }).click();
		const ddl = page.getByLabel("Schema DDL");
		await ddl.click();
		await ddl.fill("CREATE TABLE t (id int PRIMARY KEY);");
		await page.waitForTimeout(600);

		await page.reload();
		await page.waitForSelector(".react-flow__node", { timeout: 15000 });
		await page.locator("button", { hasText: "Schema" }).click();
		await expect(page.getByLabel("Schema DDL")).toHaveValue(/CREATE TABLE t/);
	});

	test("invalid DDL shows an error but keeps the diagram", async ({ page }) => {
		await page.locator("button", { hasText: "Schema" }).click();
		const ddl = page.locator("textarea");
		await ddl.click();
		await ddl.fill("CREATE TABLE (");
		await page.waitForTimeout(600);

		const body = await page.locator("body").textContent();
		expect(body).toMatch(/couldn't read the schema/i);
		const nodes = page.locator(".react-flow__node");
		expect(await nodes.count()).toBeGreaterThanOrEqual(5);
	});
});
