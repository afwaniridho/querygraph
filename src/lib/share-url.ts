import { type Dialect, isDialect } from "#/lib/dialect";

const SHARE_VERSION = 1;

export interface ShareState {
	v: typeof SHARE_VERSION;
	dialect: Dialect;
	sql: string;
	ddl: string;
	schemaOpen: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
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
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padding = (4 - (base64.length % 4)) % 4;
	return base64 + "=".repeat(padding);
}

export function encodeShareState(payload: ShareState): string {
	const json = JSON.stringify(payload);
	return toBase64Url(bytesToBase64(new TextEncoder().encode(json)));
}

export function decodeShareState(value: string): ShareState | null {
	try {
		const decoded = new TextDecoder().decode(
			base64ToBytes(fromBase64Url(value)),
		);
		const parsed = JSON.parse(decoded) as Partial<ShareState>;
		if (parsed.v !== SHARE_VERSION) return null;
		if (!isDialect(parsed.dialect)) return null;
		if (typeof parsed.sql !== "string") return null;
		if (typeof parsed.ddl !== "string") return null;
		if (typeof parsed.schemaOpen !== "boolean") return null;
		return {
			v: SHARE_VERSION,
			dialect: parsed.dialect,
			sql: parsed.sql,
			ddl: parsed.ddl,
			schemaOpen: parsed.schemaOpen,
		};
	} catch {
		return null;
	}
}
