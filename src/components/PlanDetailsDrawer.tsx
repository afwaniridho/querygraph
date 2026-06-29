import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { explainNode } from "#/lib/explain/explain";
import {
	estimateRatio,
	filteringPercent,
	formatNumber,
	totalActualRows,
	totalActualTime,
} from "#/lib/explain/metrics";
import type { PlanFinding, PlanNode } from "#/lib/explain/types";

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
	<div className="flex justify-between gap-4 border-b border-rule-soft py-1.5 text-xs">
		<dt className="text-ink-4">{label}</dt>
		<dd className="text-right font-mono text-ink-2">{value}</dd>
	</div>
);

export function PlanDetailsDrawer({
	node,
	findings,
	onClose,
}: {
	node: PlanNode;
	findings: PlanFinding[];
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		closeRef.current?.focus();
		const listener = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [onClose]);
	const ratio = estimateRatio(node);
	const filtered = filteringPercent(node);
	return (
		<aside
			role="dialog"
			aria-modal="true"
			aria-labelledby="plan-details-title"
			className="fixed inset-x-0 bottom-0 z-40 max-h-[82dvh] overflow-y-auto border-t border-rule bg-paper shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:w-[26rem] md:border-t-0 md:border-l"
			data-testid="plan-details"
		>
			<div className="sticky top-0 flex items-start gap-3 border-b border-rule bg-paper px-5 py-4">
				<div className="min-w-0 flex-1">
					<p className="font-mono text-[0.6rem] tracking-widest text-accent uppercase">
						Plan operation
					</p>
					<h2
						id="plan-details-title"
						className="mt-1 font-display text-xl font-semibold"
					>
						{node.nodeType}
					</h2>
					{node.relationName ? (
						<p className="mt-1 text-xs text-ink-3">
							{node.schema ? `${node.schema}.` : ""}
							{node.relationName}
						</p>
					) : null}
				</div>
				<button
					ref={closeRef}
					type="button"
					onClick={onClose}
					className="rounded p-2 hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-accent"
					aria-label="Close node details"
				>
					<X size={18} />
				</button>
			</div>
			<div className="space-y-6 p-5">
				<section>
					<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
						What happened
					</h3>
					<p className="mt-2 text-sm leading-relaxed text-ink-2">
						{explainNode(node)}
					</p>
				</section>
				<section>
					<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
						Estimates
					</h3>
					<dl className="mt-2">
						<Row
							label="Cost (planner units)"
							value={`${node.startupCost ?? "—"}..${node.totalCost ?? "—"}`}
						/>
						<Row label="Rows" value={node.planRows ?? "—"} />
						<Row
							label="Width"
							value={
								node.planWidth !== undefined ? `${node.planWidth} bytes` : "—"
							}
						/>
					</dl>
				</section>
				{node.actualRows !== undefined ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Runtime
						</h3>
						<dl className="mt-2">
							<Row
								label="Time per loop"
								value={`${node.actualStartupTime ?? "—"}..${node.actualTotalTime ?? "—"} ms`}
							/>
							<Row
								label="Rows per loop"
								value={formatNumber(node.actualRows)}
							/>
							<Row label="Loops" value={node.actualLoops ?? 1} />
							<Row
								label="Loop-aware rows"
								value={formatNumber(totalActualRows(node) ?? 0)}
							/>
							<Row
								label="Loop-aware time"
								value={`${formatNumber(totalActualTime(node) ?? 0)} ms (derived)`}
							/>
						</dl>
						<p className="mt-2 text-[0.68rem] leading-relaxed text-ink-4">
							PostgreSQL actual row and time values can be per-loop averages.
							Parent times are inclusive and must not be summed with child
							times.
						</p>
					</section>
				) : null}
				{ratio !== undefined ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Estimate quality
						</h3>
						<p className="mt-2 text-sm text-ink-2">
							{formatNumber(ratio)}× difference, comparing per-loop estimated
							and actual rows.
						</p>
					</section>
				) : null}
				{node.filter ||
				node.joinFilter ||
				node.indexCondition ||
				node.recheckCondition ||
				node.rowsRemovedByFilter !== undefined ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Filtering
						</h3>
						<dl className="mt-2">
							{node.filter ? <Row label="Filter" value={node.filter} /> : null}
							{node.joinFilter ? (
								<Row label="Join filter" value={node.joinFilter} />
							) : null}
							{node.indexCondition ? (
								<Row label="Index condition" value={node.indexCondition} />
							) : null}
							{node.recheckCondition ? (
								<Row label="Recheck" value={node.recheckCondition} />
							) : null}
							{node.rowsRemovedByFilter !== undefined ? (
								<Row
									label="Rows removed"
									value={formatNumber(node.rowsRemovedByFilter)}
								/>
							) : null}
							{filtered !== undefined ? (
								<Row
									label="Removed"
									value={`${formatNumber(filtered)}% per loop`}
								/>
							) : null}
						</dl>
					</section>
				) : null}
				{node.shared ||
				node.local ||
				node.temp ||
				node.ioReadTime !== undefined ||
				node.ioWriteTime !== undefined ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Buffers & I/O
						</h3>
						<dl className="mt-2">
							{(["shared", "local", "temp"] as const).map((kind) =>
								node[kind] ? (
									<Row
										key={kind}
										label={`${kind} blocks`}
										value={`hit ${node[kind]?.hit ?? 0} · read ${node[kind]?.read ?? 0} · dirtied ${node[kind]?.dirtied ?? 0} · written ${node[kind]?.written ?? 0}`}
									/>
								) : null,
							)}
							{node.ioReadTime !== undefined ? (
								<Row label="I/O read time" value={`${node.ioReadTime} ms`} />
							) : null}
							{node.ioWriteTime !== undefined ? (
								<Row label="I/O write time" value={`${node.ioWriteTime} ms`} />
							) : null}
						</dl>
					</section>
				) : null}
				{node.sortMethod ||
				node.hashBatches !== undefined ||
				node.workers.length ||
				node.heapFetches !== undefined ||
				node.joinType ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Node-specific properties
						</h3>
						<dl className="mt-2">
							{node.joinType ? (
								<Row label="Join type" value={node.joinType} />
							) : null}
							{node.hashCondition ? (
								<Row label="Hash condition" value={node.hashCondition} />
							) : null}
							{node.sortMethod ? (
								<Row label="Sort method" value={node.sortMethod} />
							) : null}
							{node.sortSpaceUsed !== undefined ? (
								<Row
									label="Sort space"
									value={`${node.sortSpaceUsed} kB ${node.sortSpaceType ?? ""}`}
								/>
							) : null}
							{node.hashBuckets !== undefined ? (
								<Row label="Hash buckets" value={node.hashBuckets} />
							) : null}
							{node.hashBatches !== undefined ? (
								<Row label="Hash batches" value={node.hashBatches} />
							) : null}
							{node.peakMemoryUsage !== undefined ? (
								<Row
									label="Peak hash memory"
									value={`${node.peakMemoryUsage} kB`}
								/>
							) : null}
							{node.heapFetches !== undefined ? (
								<Row label="Heap fetches" value={node.heapFetches} />
							) : null}
							{node.workersPlanned !== undefined ? (
								<Row
									label="Workers planned / launched"
									value={`${node.workersPlanned} / ${node.workersLaunched ?? "—"}`}
								/>
							) : null}
							{node.workers.length ? (
								<Row
									label="Worker detail"
									value={node.workers
										.map(
											(worker) =>
												`#${worker.number ?? "?"}: ${worker.actualRows ?? "—"} rows`,
										)
										.join(" · ")}
								/>
							) : null}
						</dl>
					</section>
				) : null}
				{findings.length ? (
					<section>
						<h3 className="font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
							Guidance
						</h3>
						{findings.map((item) => (
							<div
								key={item.ruleId}
								className="mt-2 border-l-2 border-accent pl-3"
							>
								<p className="text-sm font-semibold">{item.title}</p>
								<p className="mt-1 text-xs leading-relaxed text-ink-3">
									{item.explanation}
								</p>
								<ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-3">
									{item.suggestions.map((suggestion) => (
										<li key={suggestion}>{suggestion}</li>
									))}
								</ul>
							</div>
						))}
					</section>
				) : null}
				<details>
					<summary className="cursor-pointer font-mono text-[0.65rem] tracking-widest text-ink-3 uppercase">
						Raw properties
					</summary>
					<pre className="mt-2 overflow-x-auto rounded border border-rule bg-paper-2 p-3 font-mono text-[0.65rem] leading-relaxed text-ink-2">
						{JSON.stringify(node.raw, null, 2)}
					</pre>
				</details>
			</div>
		</aside>
	);
}
