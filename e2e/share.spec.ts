import { expect, test } from "@playwright/test";
import {
	buildShareImagePath,
	buildSharePath,
	encodeShareState,
	SHARE_LIMITS,
	type ShareState,
} from "../src/lib/share-url";

function sharedState(overrides: Partial<ShareState> = {}): ShareState {
	return {
		v: 2,
		dialect: "postgres",
		sql: "SELECT account_secret FROM private_accounts WHERE tenant_id = 42 LIMIT 5;",
		ddl: "",
		schemaOpen: false,
		preview: {
			statement: "SELECT",
			steps: 4,
			tables: 1,
			clauses: ["WHERE", "LIMIT"],
			health: { info: 0, warning: 1, danger: 0 },
		},
		...overrides,
	};
}

test.describe("share pages", () => {
	test("crawler HTML has safe query-specific social metadata", async ({
		request,
	}) => {
		const payload = encodeShareState(sharedState());
		const response = await request.get(`/share/v2/${payload}`);
		const html = await response.text();
		const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";

		expect(response.ok()).toBe(true);
		expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
		expect(response.headers()["content-security-policy"]).toContain(
			"frame-ancestors 'none'",
		);
		expect(response.headers()["cache-control"]).toContain("public");
		expect(head).toContain("PostgreSQL SELECT query visualization");
		expect(head).toContain('property="og:image"');
		expect(head).toContain('name="twitter:card"');
		expect(head).toContain("summary_large_image");
		expect(head).toContain("noindex, nofollow");
		expect(head).toContain('rel="canonical"');
		expect(head).not.toContain("account_secret");
		expect(head).not.toContain("private_accounts");
		expect(head).not.toContain("tenant_id");
		expect(head).not.toContain("42");
		expect(html).not.toContain("account_secret");
		expect(html).not.toContain("private_accounts");
		expect(html).not.toContain("tenant_id");
	});

	test("OG image route returns a privacy-safe SVG and invalid fallback", async ({
		request,
	}) => {
		const payload = encodeShareState(
			sharedState({ dialect: "mysql", sql: "SELECT * FROM `vault_entries`;" }),
		);
		const response = await request.get(buildShareImagePath(payload));
		const svg = await response.text();

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/svg+xml");
		expect(response.headers()["cache-control"]).toContain("immutable");
		expect(svg).toContain("MYSQL · SELECT");
		expect(svg).not.toContain("vault_entries");

		const invalid = await request.get("/share-image/v2/not-valid");
		expect(invalid.status()).toBe(400);
		expect(invalid.headers()["cache-control"]).toBe("no-store");
		expect(await invalid.text()).toContain("QueryGraph");
	});

	for (const dialect of ["postgres", "mysql"] as const) {
		test(`opens a fresh ${dialect} share and restores the visualization`, async ({
			page,
		}) => {
			const state = sharedState({
				dialect,
				sql:
					dialect === "postgres"
						? "SELECT * FROM invoices WHERE id = 9;"
						: "SELECT * FROM `invoices` WHERE id = 9;",
			});
			await page.goto(buildSharePath(state));
			await page.waitForSelector(".react-flow__node", { timeout: 15_000 });

			await expect(page.getByTestId("shared-query-indicator")).toContainText(
				"Shared query",
			);
			await expect(page.getByTestId("shared-query-indicator")).toContainText(
				"local copy",
			);
			await expect(
				page.getByRole("button", {
					name: dialect === "postgres" ? "PostgreSQL" : "MySQL",
				}),
			).toHaveAttribute("data-on", "true");
			await expect(page.locator(".monaco-editor")).toContainText("invoices");

			const editorLayout = await page.locator(".monaco-editor").evaluate(
				(editor) => {
					const overflowGuard = editor.querySelector(".overflow-guard");
					const lineNumber = editor.querySelector(".line-numbers");
					const viewLine = editor.querySelector(".view-line");
					return {
						overflowGuardPosition: overflowGuard
							? getComputedStyle(overflowGuard).position
							: null,
						lineNumberY: lineNumber?.getBoundingClientRect().y ?? null,
						viewLineY: viewLine?.getBoundingClientRect().y ?? null,
					};
				},
			);
			expect(editorLayout.overflowGuardPosition).toBe("relative");
			expect(editorLayout.lineNumberY).toBe(editorLayout.viewLineY);
		});
	}

	test("restores DDL, allows local edits, and shares the modified query", async ({
		context,
		page,
	}) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: "http://localhost:3456",
		});
		const original = sharedState({
			sql: "SELECT * FROM invoices WHERE id = 9;",
			ddl: "CREATE TABLE invoices (id int PRIMARY KEY);",
			schemaOpen: true,
		});
		await page.goto(buildSharePath(original));
		await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
		await expect(page.getByLabel("Schema DDL")).toContainText(
			"CREATE TABLE invoices",
		);

		const editor = page.locator(".monaco-editor");
		await editor.click();
		await page.keyboard.press(
			process.platform === "darwin" ? "Meta+A" : "Control+A",
		);
		await page.keyboard.type("SELECT * FROM invoices WHERE id = 10;");
		await page.getByRole("button", { name: "Share" }).click();
		await page.getByTestId("copy-share-link").click();
		await expect(
			page.getByText(/Link copied|Link ready to copy manually/),
		).toBeVisible();
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toContain("/share/v2/");
		expect(copied).not.toBe(
			new URL(buildSharePath(original), "http://localhost:3456").toString(),
		);
	});

	test("shows an accessible manual fallback when clipboard writing fails", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "clipboard", {
				configurable: true,
				get: () => ({
					writeText: () => Promise.reject(new Error("denied")),
				}),
			});
		});
		await page.goto("/");
		await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
		await page.evaluate(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: () => Promise.reject(new Error("denied")),
				},
			});
		});
		await page.getByRole("button", { name: "Share" }).click();
		await page.getByTestId("copy-share-link").click();

		const fallback = page.getByTestId("share-url-fallback");
		await expect(fallback).toBeVisible();
		await expect(fallback).toHaveValue(/\/share\/v2\//);
		await expect(page.getByText("Clipboard unavailable")).toBeVisible();
	});

	test("keeps editor content intact when DDL exceeds link limits", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
		await page.getByRole("button", { name: "Schema" }).click();
		const oversized = `CREATE TABLE huge_schema (value text);${" ".repeat(SHARE_LIMITS.ddlBytes)}`;
		await page.getByLabel("Schema DDL").fill(oversized);
		await page.getByRole("button", { name: "Share" }).click();
		await page.getByTestId("copy-share-link").click();

		await expect(page.getByTestId("share-error")).toContainText(
			"too large for a self-contained link",
		);
		await expect(page.getByLabel("Schema DDL")).toHaveValue(oversized);
	});

	test("share flow remains usable on mobile", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "QueryGraph" })).toBeVisible();
		await page.getByRole("button", { name: "Share" }).click();

		await expect(
			page.getByRole("dialog", { name: "Share this visualization" }),
		).toBeVisible();
		await expect(page.getByTestId("copy-share-link")).toBeVisible();
		await expect(page.getByTestId("copy-markdown-link")).toBeVisible();
	});
});
