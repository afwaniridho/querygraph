import type { Node } from "@xyflow/react";
import { ArrowUpRight, BookOpen, Gauge, X } from "lucide-react";
import type { AccessMethod, AccessPathInfo } from "#/lib/access-path";
import type { Dialect } from "#/lib/dialect";
import { lookupClause } from "#/lib/encyclopedia";
import { detailedContext } from "#/lib/narrate";
import { iconByKind } from "./SqlNode";

const accessHeading: Record<AccessMethod, string> = {
	pk_lookup: "Primary-key lookup",
	unique_lookup: "Unique-index lookup",
	index_seek: "Index seek",
	index_range: "Index range scan",
	covering: "Covering index (index-only)",
	full_scan: "Full table scan",
};

interface Props {
	node: Node;
	rawSql: string;
	dialect: Dialect;
	closing: boolean;
	onClose: () => void;
}

function renderWithCode(text: string) {
	const parts = text.split(/(`[^`]+`)/g);
	let cursor = 0;
	return parts.map((part) => {
		const key = `${cursor}:${part}`;
		cursor += part.length;
		if (part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					key={key}
					className="rounded-sm bg-paper-3 px-1 py-0.5 font-mono text-[0.8125rem] text-teal-2"
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		return <span key={key}>{part}</span>;
	});
}

export function NodeDetailsPanel({
	node,
	rawSql,
	dialect,
	closing,
	onClose,
}: Props) {
	const kind = (node.data.kind as string) ?? "operation";
	const label = (node.data.label as string) ?? "";
	const loc = node.data.loc as { start: number; end: number } | undefined;
	const entry = lookupClause(kind, dialect);
	const Icon = iconByKind[kind] ?? BookOpen;
	const snippet = loc ? rawSql.slice(loc.start, loc.end).trim() : "";
	const access = node.data.access as AccessPathInfo | undefined;

	return (
		<aside
			className="flex h-full w-full flex-col overflow-y-auto border-l border-rule bg-paper"
			style={{
				animation: `${closing ? "qg-panel-out" : "qg-panel-in"} ${closing ? "0.18s" : "0.32s"} ease forwards`,
			}}
		>
			<header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
				<div className="flex min-w-0 items-center gap-2.5">
					<Icon
						size={18}
						strokeWidth={2}
						style={{ color: "var(--node-hue, var(--color-teal))" }}
					/>
					<h2 className="font-display text-lg leading-tight font-semibold text-ink">
						{entry.heading}
					</h2>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close field notes"
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-3 transition hover:bg-paper-2 hover:text-ink"
				>
					<X size={18} />
				</button>
			</header>

			{snippet && (
				<pre className="border-b border-rule bg-paper-2 px-5 py-3 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap break-words text-ink-3">
					{snippet}
				</pre>
			)}

			{access && (
				<section
					className="border-b border-rule px-5 py-4"
					style={{
						background:
							access.method === "full_scan" ? "#b8542a0a" : "#1f6b6b0a",
					}}
				>
					<p className="mb-2 flex items-center gap-1.5 font-mono text-[0.6875rem] tracking-wide text-ink-4 uppercase">
						<Gauge size={13} />
						Estimated access path
					</p>
					<p className="mb-1 text-[0.9375rem] font-semibold text-ink">
						{accessHeading[access.method]}
						{access.index ? (
							<span className="ml-1.5 font-mono text-[0.8125rem] font-normal text-teal-2">
								{access.index}
							</span>
						) : null}
					</p>
					<p className="text-[0.875rem] leading-relaxed text-ink-2">
						{renderWithCode(access.reason)}
					</p>
					<p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-4">
						A rule-based estimate from your DDL, not a real query plan. Run
						EXPLAIN for the planner's actual choice.
					</p>
				</section>
			)}

			<section className="border-b border-rule px-5 py-4">
				<p className="mb-2 font-mono text-[0.6875rem] tracking-wide text-ink-4 uppercase">
					In this query
				</p>
				<p className="text-[0.9375rem] leading-relaxed text-ink">
					{renderWithCode(detailedContext(kind, label, dialect, access))}
				</p>
			</section>

			<section className="border-b border-rule px-5 py-4">
				<p className="mb-2 font-mono text-[0.6875rem] tracking-wide text-ink-4 uppercase">
					What it is
				</p>
				<p className="text-[0.9375rem] leading-relaxed text-ink-2">
					{entry.summary}
				</p>
			</section>

			<div className="px-5 py-4">
				<a
					href={entry.docs}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-teal transition hover:text-teal-2 hover:underline"
				>
					{dialect === "mysql" ? "MySQL" : "PostgreSQL"} docs
					<ArrowUpRight size={14} />
				</a>
			</div>
		</aside>
	);
}
