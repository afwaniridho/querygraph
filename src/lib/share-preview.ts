import type { Node } from "@xyflow/react";
import type { Dialect } from "#/lib/dialect";
import type { HealthFinding } from "#/lib/query-health/analyze";
import {
	CLAUSE_CATEGORIES,
	type ClauseCategory,
	type PreviewSummary,
	type StatementType,
} from "#/lib/share-url";

const KIND_TO_CLAUSE: Partial<Record<string, ClauseCategory>> = {
	join: "JOIN",
	straight_join: "JOIN",
	where: "WHERE",
	groupby: "GROUP BY",
	having: "HAVING",
	orderby: "ORDER BY",
	limit: "LIMIT",
	cte: "CTE",
	union: "UNION",
};

const KIND_TO_STATEMENT: Partial<Record<string, StatementType>> = {
	select: "SELECT",
	insert: "INSERT",
	insert_ignore: "INSERT",
	replace: "INSERT",
	update: "UPDATE",
	multi_table_update: "UPDATE",
	delete: "DELETE",
	multi_table_delete: "DELETE",
	create: "CREATE",
};

export function createPreviewSummary(
	nodes: Node[],
	findings: HealthFinding[],
): PreviewSummary {
	const kinds = nodes.map((node) => String(node.data?.kind ?? ""));
	const clauses = CLAUSE_CATEGORIES.filter((clause) =>
		kinds.some((kind) => KIND_TO_CLAUSE[kind] === clause),
	);
	const statement =
		kinds
			.map((kind) => KIND_TO_STATEMENT[kind])
			.find((candidate): candidate is StatementType => Boolean(candidate)) ??
		"OTHER";
	return {
		statement,
		steps: Math.min(nodes.length, 999),
		tables: Math.min(kinds.filter((kind) => kind === "table").length, 999),
		clauses,
		health: {
			info: Math.min(
				findings.filter((finding) => finding.severity === "info").length,
				999,
			),
			warning: Math.min(
				findings.filter((finding) => finding.severity === "warning").length,
				999,
			),
			danger: Math.min(
				findings.filter((finding) => finding.severity === "danger").length,
				999,
			),
		},
	};
}

export function dialectLabel(dialect: Dialect): string {
	return dialect === "postgres" ? "PostgreSQL" : "MySQL";
}

export function previewTitle(
	dialect: Dialect,
	summary: PreviewSummary,
): string {
	const label = dialectLabel(dialect);
	if (summary.statement === "OTHER") {
		return `QueryGraph shared ${label} visualization`;
	}
	return `${label} ${summary.statement} query visualization`;
}

export function previewDescription(
	dialect: Dialect,
	summary: PreviewSummary,
): string {
	const label = dialectLabel(dialect);
	const clauses =
		summary.clauses.length > 0 ? ` with ${summary.clauses.join(", ")}` : "";
	const tableText = `${summary.tables} table${summary.tables === 1 ? "" : "s"}`;
	return `${label} ${summary.statement.toLowerCase()} query${clauses}: ${summary.steps} logical step${summary.steps === 1 ? "" : "s"}, ${tableText}. Open the interactive visualization.`;
}

function escapeXml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&apos;",
			})[character] ?? character,
	);
}

export function renderShareImageSvg(
	dialect: Dialect,
	summary: PreviewSummary,
): string {
	const label = escapeXml(dialectLabel(dialect));
	const statement = escapeXml(summary.statement);
	const healthTotal =
		summary.health.info + summary.health.warning + summary.health.danger;
	const healthLine =
		healthTotal > 0
			? `${summary.health.danger} critical · ${summary.health.warning} warnings · ${summary.health.info} notes`
			: "No health summary included";
	const pipelineCount = Math.max(3, Math.min(summary.steps, 7));
	const pipeline = Array.from({ length: pipelineCount }, (_, index) => {
		const x = 116 + index * 142;
		const color =
			index % 3 === 0 ? "#b8542a" : index % 3 === 1 ? "#1f6b6b" : "#b8893a";
		return `<rect x="${x}" y="370" width="104" height="54" rx="10" fill="${color}" opacity="0.92"/><circle cx="${x + 52}" cy="397" r="7" fill="#f7f3ec"/>${index < pipelineCount - 1 ? `<path d="M ${x + 104} 397 H ${x + 136}" stroke="#6b6357" stroke-width="4"/><path d="M ${x + 128} 389 L ${x + 138} 397 L ${x + 128} 405" fill="none" stroke="#6b6357" stroke-width="4"/>` : ""}`;
	}).join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
<title id="title">QueryGraph shared SQL visualization</title>
<desc id="desc">${label} ${statement} query with ${summary.steps} logical steps</desc>
<rect width="1200" height="630" fill="#f7f3ec"/>
<rect x="54" y="54" width="1092" height="522" rx="26" fill="#fffdf8" stroke="#d9d0c0" stroke-width="2"/>
<circle cx="112" cy="115" r="29" fill="#b8542a"/>
<path d="M96 115h32M112 99v32" stroke="#f7f3ec" stroke-width="5" stroke-linecap="round"/>
<text x="160" y="127" font-family="Georgia,serif" font-size="42" font-weight="700" fill="#1a1814">QueryGraph</text>
<text x="84" y="220" font-family="ui-monospace,monospace" font-size="22" letter-spacing="3" fill="#b8542a">${label.toUpperCase()} · ${statement}</text>
<text x="84" y="292" font-family="Georgia,serif" font-size="48" font-weight="600" fill="#1a1814">${summary.steps} logical step${summary.steps === 1 ? "" : "s"}</text>
<text x="84" y="334" font-family="ui-monospace,monospace" font-size="20" fill="#6b6357">${summary.tables} referenced table${summary.tables === 1 ? "" : "s"} · ${escapeXml(healthLine)}</text>
${pipeline}
<text x="84" y="520" font-family="ui-monospace,monospace" font-size="22" fill="#1f6b6b">Open interactive visualization →</text>
</svg>`;
}

export function renderFallbackShareImageSvg(): string {
	return renderShareImageSvg("postgres", {
		statement: "OTHER",
		steps: 0,
		tables: 0,
		clauses: [],
		health: { info: 0, warning: 0, danger: 0 },
	});
}
