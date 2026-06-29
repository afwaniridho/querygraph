import { deflateSync, Inflate } from "fflate";
import { type Dialect, isDialect } from "#/lib/dialect";

export const LEGACY_SHARE_VERSION = 1;
export const SHARE_VERSION = 2;
export const SHARE_PATH_PREFIX = `/share/v${SHARE_VERSION}`;
export const SHARE_IMAGE_PATH_PREFIX = `/share-image/v${SHARE_VERSION}`;

export const SHARE_LIMITS = {
	sqlBytes: 32_768,
	ddlBytes: 32_768,
	decodedBytes: 72_000,
	encodedPayloadCharacters: 15_000,
	urlCharacters: 15_900,
} as const;

export const STATEMENT_TYPES = [
	"SELECT",
	"INSERT",
	"UPDATE",
	"DELETE",
	"CREATE",
	"OTHER",
] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const CLAUSE_CATEGORIES = [
	"JOIN",
	"WHERE",
	"GROUP BY",
	"HAVING",
	"ORDER BY",
	"LIMIT",
	"CTE",
	"UNION",
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export interface PreviewSummary {
	statement: StatementType;
	steps: number;
	tables: number;
	clauses: ClauseCategory[];
	health: {
		info: number;
		warning: number;
		danger: number;
	};
}

export interface ShareState {
	v: typeof SHARE_VERSION;
	dialect: Dialect;
	sql: string;
	ddl: string;
	schemaOpen: boolean;
	preview: PreviewSummary;
}

export interface LegacyShareState {
	v: typeof LEGACY_SHARE_VERSION;
	dialect: Dialect;
	sql: string;
	ddl: string;
	schemaOpen: boolean;
}

export type RestorableShareState = Pick<
	ShareState,
	"dialect" | "sql" | "ddl" | "schemaOpen"
> & {
	preview?: PreviewSummary;
};

export type ShareDecodeError =
	| "invalid"
	| "unsupported-version"
	| "encoded-too-large"
	| "decoded-too-large"
	| "content-too-large";

export type ShareDecodeResult =
	| { ok: true; state: ShareState }
	| { ok: false; error: ShareDecodeError };

export class ShareLimitError extends Error {
	readonly code: "content-too-large" | "url-too-large";

	constructor(code: "content-too-large" | "url-too-large") {
		super(
			code === "url-too-large"
				? "This query is too large for a self-contained share link."
				: "The SQL or schema exceeds the share limits.",
		);
		this.name = "ShareLimitError";
		this.code = code;
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize),
		);
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function toBase64Url(base64: string): string {
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Base64url");
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = (4 - (base64.length % 4)) % 4;
	return base64 + "=".repeat(padding);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isBoundedCount(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 999
	);
}

export function validatePreviewSummary(value: unknown): PreviewSummary | null {
	if (!isPlainRecord(value)) return null;
	if (
		!hasExactKeys(value, ["statement", "steps", "tables", "clauses", "health"])
	)
		return null;
	if (
		typeof value.statement !== "string" ||
		!STATEMENT_TYPES.includes(value.statement as StatementType)
	)
		return null;
	if (!isBoundedCount(value.steps) || !isBoundedCount(value.tables))
		return null;
	if (
		!Array.isArray(value.clauses) ||
		value.clauses.length > CLAUSE_CATEGORIES.length ||
		!value.clauses.every(
			(clause) =>
				typeof clause === "string" &&
				CLAUSE_CATEGORIES.includes(clause as ClauseCategory),
		) ||
		new Set(value.clauses).size !== value.clauses.length
	)
		return null;
	if (
		!isPlainRecord(value.health) ||
		!hasExactKeys(value.health, ["info", "warning", "danger"]) ||
		!isBoundedCount(value.health.info) ||
		!isBoundedCount(value.health.warning) ||
		!isBoundedCount(value.health.danger)
	)
		return null;
	return {
		statement: value.statement as StatementType,
		steps: value.steps,
		tables: value.tables,
		clauses: value.clauses as ClauseCategory[],
		health: {
			info: value.health.info,
			warning: value.health.warning,
			danger: value.health.danger,
		},
	};
}

function validateV2State(value: unknown): ShareDecodeResult {
	if (!isPlainRecord(value)) return { ok: false, error: "invalid" };
	if (value.v !== SHARE_VERSION) {
		return { ok: false, error: "unsupported-version" };
	}
	if (
		!hasExactKeys(value, [
			"v",
			"dialect",
			"sql",
			"ddl",
			"schemaOpen",
			"preview",
		]) ||
		!isDialect(value.dialect) ||
		typeof value.sql !== "string" ||
		typeof value.ddl !== "string" ||
		typeof value.schemaOpen !== "boolean"
	)
		return { ok: false, error: "invalid" };
	const sqlBytes = encoder.encode(value.sql).byteLength;
	const ddlBytes = encoder.encode(value.ddl).byteLength;
	if (sqlBytes > SHARE_LIMITS.sqlBytes || ddlBytes > SHARE_LIMITS.ddlBytes) {
		return { ok: false, error: "content-too-large" };
	}
	const preview = validatePreviewSummary(value.preview);
	if (!preview) return { ok: false, error: "invalid" };
	return {
		ok: true,
		state: {
			v: SHARE_VERSION,
			dialect: value.dialect,
			sql: value.sql,
			ddl: value.ddl,
			schemaOpen: value.schemaOpen,
			preview,
		},
	};
}

function inflateBounded(compressed: Uint8Array): Uint8Array {
	const chunks: Uint8Array[] = [];
	let total = 0;
	const inflate = new Inflate((chunk) => {
		total += chunk.byteLength;
		if (total > SHARE_LIMITS.decodedBytes) {
			throw new ShareLimitError("content-too-large");
		}
		chunks.push(chunk);
	});
	inflate.push(compressed, true);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

export function encodeShareState(payload: ShareState): string {
	const validated = validateV2State(payload);
	if (!validated.ok) throw new ShareLimitError("content-too-large");
	const json = encoder.encode(JSON.stringify(validated.state));
	if (json.byteLength > SHARE_LIMITS.decodedBytes) {
		throw new ShareLimitError("content-too-large");
	}
	const encoded = toBase64Url(bytesToBase64(deflateSync(json, { level: 9 })));
	if (encoded.length > SHARE_LIMITS.encodedPayloadCharacters) {
		throw new ShareLimitError("url-too-large");
	}
	return encoded;
}

export function decodeShareState(value: string): ShareDecodeResult {
	if (value.length > SHARE_LIMITS.encodedPayloadCharacters) {
		return { ok: false, error: "encoded-too-large" };
	}
	try {
		const compressed = base64ToBytes(fromBase64Url(value));
		const json = inflateBounded(compressed);
		if (json.byteLength > SHARE_LIMITS.decodedBytes) {
			return { ok: false, error: "decoded-too-large" };
		}
		return validateV2State(JSON.parse(decoder.decode(json)));
	} catch (error) {
		if (error instanceof ShareLimitError) {
			return { ok: false, error: "decoded-too-large" };
		}
		return { ok: false, error: "invalid" };
	}
}

export function decodeLegacyShareState(value: string): LegacyShareState | null {
	if (value.length > SHARE_LIMITS.encodedPayloadCharacters) return null;
	try {
		const decoded = decoder.decode(base64ToBytes(fromBase64Url(value)));
		if (encoder.encode(decoded).byteLength > SHARE_LIMITS.decodedBytes)
			return null;
		const parsed: unknown = JSON.parse(decoded);
		if (
			!isPlainRecord(parsed) ||
			!hasExactKeys(parsed, ["v", "dialect", "sql", "ddl", "schemaOpen"]) ||
			parsed.v !== LEGACY_SHARE_VERSION ||
			!isDialect(parsed.dialect) ||
			typeof parsed.sql !== "string" ||
			typeof parsed.ddl !== "string" ||
			typeof parsed.schemaOpen !== "boolean" ||
			encoder.encode(parsed.sql).byteLength > SHARE_LIMITS.sqlBytes ||
			encoder.encode(parsed.ddl).byteLength > SHARE_LIMITS.ddlBytes
		)
			return null;
		return {
			v: LEGACY_SHARE_VERSION,
			dialect: parsed.dialect,
			sql: parsed.sql,
			ddl: parsed.ddl,
			schemaOpen: parsed.schemaOpen,
		};
	} catch {
		return null;
	}
}

export function buildSharePath(payload: ShareState): string {
	return `${SHARE_PATH_PREFIX}/${encodeShareState(payload)}`;
}

export function buildShareImagePath(encodedPayload: string): string {
	return `${SHARE_IMAGE_PATH_PREFIX}/${encodedPayload}`;
}
