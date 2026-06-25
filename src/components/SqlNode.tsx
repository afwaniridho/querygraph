import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	ArrowDownUp,
	ArrowLeftFromLine,
	Boxes,
	Columns3,
	Combine,
	Database,
	Filter,
	FunnelPlus,
	Info,
	Layers,
	type LucideIcon,
	Milestone,
	MoveRight,
	PencilLine,
	RefreshCw,
	Repeat,
	Replace,
	Rows3,
	ScissorsLineDashed,
	SquareDashedMousePointer,
	TableProperties,
	Trash2,
	Workflow,
} from "lucide-react";
import { useContext } from "react";
import type { AccessMethod, AccessPathInfo } from "#/lib/access-path";
import { NodeActionsContext } from "#/lib/node-actions";

const accessLabel: Record<AccessMethod, string> = {
	pk_lookup: "PK lookup",
	unique_lookup: "Unique lookup",
	index_seek: "Index seek",
	index_range: "Index range",
	covering: "Covering",
	full_scan: "Full scan",
};

function AccessChip({ access }: { access: AccessPathInfo }) {
	const warn = access.method === "full_scan";
	const label = accessLabel[access.method];
	const text = access.index ? `${label} · ${access.index}` : label;
	return (
		<span
			className="inline-flex max-w-full items-center gap-1 truncate rounded-sm border px-1.5 py-0.5 font-mono text-[0.625rem] font-medium"
			style={{
				borderColor: warn ? "var(--color-node-write)" : "var(--color-teal)",
				color: warn ? "var(--color-node-write)" : "var(--color-teal-2)",
				background: warn ? "#b8542a14" : "#1f6b6b14",
			}}
			title={access.reason}
		>
			<span className="truncate">{text}</span>
		</span>
	);
}

export const iconByKind: Record<string, LucideIcon> = {
	table: Database,
	insert_target: TableProperties,
	join: Combine,
	straight_join: MoveRight,
	where: Filter,
	having: FunnelPlus,
	select: SquareDashedMousePointer,
	distinct_on: SquareDashedMousePointer,
	groupby: Boxes,
	orderby: ArrowDownUp,
	limit: ScissorsLineDashed,
	index_hint: Milestone,
	cte: Repeat,
	union: Layers,
	values: Rows3,
	insert: ArrowLeftFromLine,
	insert_ignore: ArrowLeftFromLine,
	replace: Replace,
	on_duplicate_key: RefreshCw,
	on_conflict: RefreshCw,
	update: PencilLine,
	multi_table_update: PencilLine,
	delete: Trash2,
	multi_table_delete: Trash2,
	create: TableProperties,
	column: Columns3,
	set: PencilLine,
	returning: ArrowLeftFromLine,
	operation: Workflow,
};

export function SqlNode({ id, data }: NodeProps) {
	const kind = (data.kind as string) ?? "operation";
	const Icon = iconByKind[kind] ?? Workflow;
	const step = data.step as number;
	const { openDetails } = useContext(NodeActionsContext);

	return (
		<div
			className="qg-node-card group relative w-full border border-rule bg-paper-2 transition-shadow"
			style={{ borderRadius: 2 }}
		>
			<span
				aria-hidden
				className="pointer-events-none absolute top-1 left-1 h-2 w-2 border-t border-l"
				style={{ borderColor: "var(--node-hue)" }}
			/>
			<span
				aria-hidden
				className="pointer-events-none absolute right-1 bottom-1 h-2 w-2 border-r border-b"
				style={{ borderColor: "var(--node-hue)" }}
			/>

			<Handle type="target" position={Position.Top} />

			<div
				className="flex items-center gap-2 border-b px-3 py-2"
				style={{ borderColor: "var(--color-rule-soft)" }}
			>
				<span
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[0.625rem] font-bold text-paper"
					style={{ background: "var(--node-hue)" }}
				>
					{step}
				</span>
				<Icon
					size={15}
					strokeWidth={2}
					style={{ color: "var(--node-hue)" }}
					className="shrink-0"
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] font-medium text-ink-2">
					{data.label as string}
				</span>
				<button
					type="button"
					title="Open the field notes for this step"
					onClick={(e) => {
						e.stopPropagation();
						openDetails(id);
					}}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-4 opacity-0 transition hover:bg-paper-3 hover:text-ink group-hover:opacity-100"
				>
					<Info size={14} />
				</button>
			</div>

			<p className="px-3 py-2.5 text-[0.78125rem] leading-snug text-ink-2">
				{data.prose as string}
			</p>

			{data.access ? (
				<div className="px-3 pb-2.5">
					<AccessChip access={data.access as AccessPathInfo} />
				</div>
			) : null}

			<Handle type="source" position={Position.Bottom} />
		</div>
	);
}
