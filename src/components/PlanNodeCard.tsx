import { Handle, type NodeProps, Position } from "@xyflow/react";
import { AlertTriangle, Info } from "lucide-react";
import { memo } from "react";
import { formatNumber } from "#/lib/explain/metrics";
import type { PlanFinding, PlanNode } from "#/lib/explain/types";

export interface PlanNodeData extends Record<string, unknown> {
	node: PlanNode;
	findings: PlanFinding[];
	onOpen: (node: PlanNode) => void;
}

function PlanNodeCardComponent({ data }: NodeProps) {
	const { node, findings, onOpen } = data as PlanNodeData;
	const mostSevere = findings.find((item) => item.severity === "danger")
		? "danger"
		: findings.find((item) => item.severity === "warning")
			? "warning"
			: findings.length
				? "info"
				: undefined;
	const ratio =
		node.planRows && node.actualRows
			? Math.max(
					node.actualRows / node.planRows,
					node.planRows / node.actualRows,
				)
			: undefined;
	const label =
		node.relationName ??
		node.indexName ??
		node.operation ??
		node.strategy ??
		node.parentRelationship;
	return (
		<button
			type="button"
			className="qg-plan-node w-[238px] rounded-md border border-rule bg-paper text-left shadow-[0_5px_16px_rgba(26,24,20,.08)] transition hover:border-ink-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			data-category={data.category}
			data-severity={mostSevere}
			data-testid={`plan-node-${node.id}`}
			onClick={() => onOpen(node)}
			aria-label={`Open details for ${node.nodeType}`}
		>
			<Handle type="target" position={Position.Top} />
			<div className="flex items-center gap-2 border-b border-rule-soft px-3 py-2">
				<span className="min-w-0 flex-1 truncate font-mono text-[0.68rem] font-semibold tracking-wide text-ink uppercase">
					{node.nodeType}
				</span>
				{findings.length ? (
					<span
						className="flex items-center gap-1 font-mono text-[0.58rem] uppercase"
						title={`${findings.length} finding${findings.length === 1 ? "" : "s"}, ${mostSevere}`}
						data-finding-indicator
					>
						{mostSevere === "info" ? (
							<Info size={12} />
						) : (
							<AlertTriangle size={12} />
						)}
						{findings.length}
					</span>
				) : null}
			</div>
			<div className="space-y-1 px-3 py-2.5">
				{label ? <p className="truncate text-xs text-ink-3">{label}</p> : null}
				{node.actualRows !== undefined ? (
					<>
						<p className="font-mono text-[0.68rem] text-ink-2">
							{node.actualTotalTime !== undefined
								? `${formatNumber(node.actualTotalTime)} ms · `
								: ""}
							{formatNumber(node.actualRows)} rows
						</p>
						{node.planRows !== undefined ? (
							<p className="font-mono text-[0.58rem] text-ink-4">
								Estimate: {formatNumber(node.planRows)} rows
								{ratio && ratio >= 2
									? ` · ${formatNumber(ratio)}× difference`
									: ""}
							</p>
						) : null}
						{(node.actualLoops ?? 1) > 1 ? (
							<p className="font-mono text-[0.58rem] text-ink-4">
								{formatNumber(node.actualLoops ?? 1)} loops
							</p>
						) : null}
					</>
				) : (
					<>
						<p className="font-mono text-[0.68rem] text-ink-2">
							Estimated rows: {formatNumber(node.planRows ?? 0)}
						</p>
						<p className="font-mono text-[0.58rem] text-ink-4">
							Cost: {node.startupCost ?? "—"}..{node.totalCost ?? "—"}
						</p>
					</>
				)}
			</div>
			<Handle type="source" position={Position.Bottom} />
		</button>
	);
}

export const PlanNodeCard = memo(PlanNodeCardComponent);
