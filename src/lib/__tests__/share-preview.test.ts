import { describe, expect, it } from "vitest";
import {
	previewDescription,
	previewTitle,
	renderFallbackShareImageSvg,
	renderShareImageSvg,
} from "#/lib/share-preview";

const summary = {
	statement: "SELECT" as const,
	steps: 7,
	tables: 2,
	clauses: ["JOIN", "WHERE", "GROUP BY", "LIMIT"] as const,
	health: { info: 1, warning: 2, danger: 0 },
};

describe("share preview", () => {
	it("builds useful metadata from aggregate values only", () => {
		const title = previewTitle("postgres", {
			...summary,
			clauses: [...summary.clauses],
		});
		const description = previewDescription("postgres", {
			...summary,
			clauses: [...summary.clauses],
		});

		expect(title).toBe("PostgreSQL SELECT query visualization");
		expect(description).toContain("7 logical steps");
		expect(description).toContain("2 tables");
		expect(description).toContain("JOIN, WHERE, GROUP BY, LIMIT");
	});

	it("renders a branded SVG without query-sensitive content", () => {
		const svg = renderShareImageSvg("mysql", {
			...summary,
			clauses: [...summary.clauses],
		});

		expect(svg).toContain("<svg");
		expect(svg).toContain("QueryGraph");
		expect(svg).toContain("MYSQL · SELECT");
		expect(svg).toContain("7 logical steps");
		expect(svg).toContain("Open interactive visualization");
		expect(svg).not.toContain("customers");
		expect(svg).not.toContain("SELECT *");
	});

	it("provides a valid static-safe fallback image", () => {
		const svg = renderFallbackShareImageSvg();
		expect(svg).toContain("<svg");
		expect(svg).toContain("QueryGraph");
		expect(svg).not.toContain("<script");
	});
});
