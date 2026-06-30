import { PlanParseError } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(
	input: string,
	message: string,
	code: PlanParseError["code"] = "invalid-json",
): unknown {
	try {
		return JSON.parse(input);
	} catch (error) {
		throw new PlanParseError(
			code,
			message,
			error instanceof Error ? error.message : undefined,
		);
	}
}

function parsePostgresQueryPlanValue(value: unknown): unknown {
	if (typeof value === "string") {
		return parseJson(
			value,
			"This does not appear to be PostgreSQL EXPLAIN JSON.",
		);
	}
	if (Array.isArray(value)) return value;
	throw new PlanParseError(
		"invalid-structure",
		"This does not appear to be PostgreSQL EXPLAIN JSON.",
	);
}

function parseMysqlExplainValue(value: unknown): unknown {
	if (typeof value !== "string") {
		throw new PlanParseError(
			"invalid-structure",
			"This does not appear to be MySQL EXPLAIN FORMAT=JSON output.",
		);
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		throw new PlanParseError(
			"invalid-structure",
			"MySQL text or TREE EXPLAIN output is not supported; paste JSON from EXPLAIN FORMAT=JSON.",
		);
	}
	return parseJson(
		value,
		"This does not appear to be MySQL EXPLAIN FORMAT=JSON output.",
	);
}

export function normalizePostgresExplainInput(input: string): unknown {
	const parsed = parseJson(
		input,
		"This does not appear to be PostgreSQL EXPLAIN JSON.",
	);
	if (
		Array.isArray(parsed) &&
		parsed.length === 1 &&
		object(parsed[0]) &&
		"QUERY PLAN" in parsed[0]
	) {
		return parsePostgresQueryPlanValue(parsed[0]["QUERY PLAN"]);
	}
	if (object(parsed) && "QUERY PLAN" in parsed) {
		return parsePostgresQueryPlanValue(parsed["QUERY PLAN"]);
	}
	return parsed;
}

export function normalizeMysqlExplainInput(input: string): unknown {
	const parsed = parseJson(
		input,
		"This does not appear to be MySQL EXPLAIN FORMAT=JSON output.",
	);
	if (typeof parsed === "string") return parseMysqlExplainValue(parsed);
	if (
		Array.isArray(parsed) &&
		parsed.length === 1 &&
		object(parsed[0]) &&
		"EXPLAIN" in parsed[0]
	) {
		return parseMysqlExplainValue(parsed[0].EXPLAIN);
	}
	if (object(parsed) && "EXPLAIN" in parsed) {
		return parseMysqlExplainValue(parsed.EXPLAIN);
	}
	return parsed;
}
