import { describe, expect, it } from "vitest";
import { decodeShareState, encodeShareState } from "#/lib/share-url";

function encodeRaw(value: unknown): string {
	return btoa(JSON.stringify(value))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

describe("share url state", () => {
	it("round-trips PostgreSQL state with unicode SQL", () => {
		const state = {
			v: 1 as const,
			dialect: "postgres" as const,
			sql: "SELECT 'héllo' AS label, '☕' AS icon;",
			ddl: "",
			schemaOpen: false,
		};

		expect(decodeShareState(encodeShareState(state))).toEqual(state);
	});

	it("round-trips MySQL state with backticks and DDL", () => {
		const state = {
			v: 1 as const,
			dialect: "mysql" as const,
			sql: "SELECT * FROM `customers` WHERE id = 1;",
			ddl: "CREATE TABLE customers (id int PRIMARY KEY);",
			schemaOpen: true,
		};

		expect(decodeShareState(encodeShareState(state))).toEqual(state);
	});

	it("returns null for invalid base64 or JSON", () => {
		expect(decodeShareState("not valid base64")).toBeNull();
		expect(decodeShareState("bm90IGpzb24")).toBeNull();
	});

	it("returns null for unsupported versions or dialects", () => {
		const badVersion = encodeRaw({
			v: 2,
			dialect: "postgres",
			sql: "SELECT 1;",
			ddl: "",
			schemaOpen: false,
		});
		const badDialect = encodeRaw({
			v: 1,
			dialect: "sqlite",
			sql: "SELECT 1;",
			ddl: "",
			schemaOpen: false,
		});

		expect(decodeShareState(badVersion)).toBeNull();
		expect(decodeShareState(badDialect)).toBeNull();
	});
});
