import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
	decodeLegacyShareState,
	decodeShareState,
	encodeShareState,
	SHARE_LIMITS,
	ShareLimitError,
	type ShareState,
	validatePreviewSummary,
} from "#/lib/share-url";

const preview = {
	statement: "SELECT" as const,
	steps: 7,
	tables: 2,
	clauses: ["JOIN", "WHERE", "LIMIT"] as const,
	health: { info: 1, warning: 2, danger: 0 },
};

function state(overrides: Partial<ShareState> = {}): ShareState {
	return {
		v: 2,
		dialect: "postgres",
		sql: "SELECT 1;",
		ddl: "",
		schemaOpen: false,
		preview: { ...preview, clauses: [...preview.clauses] },
		...overrides,
	};
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function encodeCompressedRaw(value: unknown): string {
	return toBase64Url(
		deflateSync(new TextEncoder().encode(JSON.stringify(value)), { level: 9 }),
	);
}

function encodeLegacyRaw(value: unknown): string {
	return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

describe("share URL state", () => {
	it("round-trips compressed PostgreSQL state with Unicode SQL", () => {
		const payload = state({
			sql: "SELECT 'héllo' AS label, '☕' AS icon;",
		});
		const encoded = encodeShareState(payload);

		expect(encoded).not.toContain("+");
		expect(encoded.length).toBeLessThan(JSON.stringify(payload).length * 2);
		expect(decodeShareState(encoded)).toEqual({ ok: true, state: payload });
	});

	it("round-trips MySQL state with DDL and preview aggregates", () => {
		const payload = state({
			dialect: "mysql",
			sql: "SELECT * FROM `customers` WHERE id = 1;",
			ddl: "CREATE TABLE customers (id int PRIMARY KEY);",
			schemaOpen: true,
		});
		expect(decodeShareState(encodeShareState(payload))).toEqual({
			ok: true,
			state: payload,
		});
	});

	it("decodes representative legacy v1 hash payloads", () => {
		const legacy = {
			v: 1,
			dialect: "mysql",
			sql: "SELECT '日本語' FROM `orders`;",
			ddl: "CREATE TABLE orders (id int);",
			schemaOpen: true,
		};
		expect(decodeLegacyShareState(encodeLegacyRaw(legacy))).toEqual(legacy);
	});

	it("rejects corrupt, invalid UTF-8, and unsupported payloads", () => {
		expect(decodeShareState("not-valid")).toEqual({
			ok: false,
			error: "invalid",
		});
		expect(
			decodeShareState(toBase64Url(deflateSync(new Uint8Array([0xff, 0xfe])))),
		).toEqual({ ok: false, error: "invalid" });
		expect(decodeShareState(encodeCompressedRaw({ ...state(), v: 3 }))).toEqual(
			{ ok: false, error: "unsupported-version" },
		);
	});

	it("rejects oversized encoded and decoded payloads", () => {
		expect(
			decodeShareState("a".repeat(SHARE_LIMITS.encodedPayloadCharacters + 1)),
		).toEqual({ ok: false, error: "encoded-too-large" });

		const bomb = encodeCompressedRaw({
			...state(),
			sql: "A".repeat(SHARE_LIMITS.decodedBytes * 4),
		});
		expect(bomb.length).toBeLessThan(SHARE_LIMITS.encodedPayloadCharacters);
		expect(decodeShareState(bomb)).toEqual({
			ok: false,
			error: "decoded-too-large",
		});
	});

	it("throws instead of truncating oversized SQL", () => {
		expect(() =>
			encodeShareState(state({ sql: "x".repeat(SHARE_LIMITS.sqlBytes + 1) })),
		).toThrow(ShareLimitError);
	});

	it("rejects extra keys and prototype-pollution-shaped JSON", () => {
		const malicious = JSON.parse(
			`{"v":2,"dialect":"postgres","sql":"SELECT 1","ddl":"","schemaOpen":false,"preview":{"statement":"SELECT","steps":1,"tables":0,"clauses":[],"health":{"info":0,"warning":0,"danger":0}},"__proto__":{"polluted":true}}`,
		);
		expect(decodeShareState(encodeCompressedRaw(malicious))).toEqual({
			ok: false,
			error: "invalid",
		});
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("strictly sanitizes privacy-safe preview summaries", () => {
		expect(validatePreviewSummary(preview)).toEqual(preview);
		expect(
			validatePreviewSummary({
				...preview,
				tableName: "<script>alert(1)</script>",
			}),
		).toBeNull();
		expect(
			validatePreviewSummary({
				...preview,
				clauses: ["WHERE", "<img onerror=alert(1)>"],
			}),
		).toBeNull();
	});
});
