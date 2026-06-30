import {
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	type Node,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Link } from "@tanstack/react-router";
import dagre from "dagre";
import {
	AlertTriangle,
	BookOpen,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	CircleHelp,
	Clipboard,
	Copy,
	Database,
	FileJson,
	Info,
	RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AboutModal } from "#/components/AboutModal";
import {
	type PlanBottleneckItem,
	rankPlanBottlenecks,
} from "#/lib/explain/bottlenecks";
import { ALL_PLAN_EXAMPLES, type PlanExample } from "#/lib/explain/examples";
import { nodeCategory } from "#/lib/explain/explain";
import { analyzePlan } from "#/lib/explain/health";
import { formatNumber } from "#/lib/explain/metrics";
import { parseMysqlPlan } from "#/lib/explain/mysql-parser";
import { PLAN_LIMITS, parsePostgresPlan } from "#/lib/explain/parser";
import {
	type ExecutionPlan,
	type PlanDatabase,
	type PlanFinding,
	type PlanNode,
	PlanParseError,
} from "#/lib/explain/types";
import { PlanBottlenecksPanel } from "./PlanBottlenecksPanel";
import { PlanDetailsDrawer } from "./PlanDetailsDrawer";
import { PlanNodeCard, type PlanNodeData } from "./PlanNodeCard";

const nodeTypes = { plan: PlanNodeCard };
const CLOSE_MS = 200;
const CURRENT_SQL_KEY = "querygraph.current-sql";
const PLAN_DATABASE_KEY = "querygraph.explain-database";
const planInputKey = (database: PlanDatabase) =>
	`querygraph.explain-input.${database}`;
const postgresEstimatedCommand = "EXPLAIN (FORMAT JSON)\nSELECT ...;";
const postgresAnalyzedCommand =
	"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\nSELECT ...;";
const mysqlEstimatedCommand = "EXPLAIN FORMAT=JSON\nSELECT ...;";

function copy(value: string) {
	return navigator.clipboard?.writeText(value);
}

function layout(
	plan: ExecutionPlan,
	findings: PlanFinding[],
	onOpen: (node: PlanNode) => void,
): { nodes: Node<PlanNodeData>[]; edges: Edge[] } {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: "TB",
		nodesep: 34,
		ranksep: 72,
		marginx: 24,
		marginy: 24,
	});
	for (const node of plan.nodes)
		graph.setNode(node.id, { width: 238, height: 132 });
	for (const node of plan.nodes) {
		for (const childId of node.childIds) graph.setEdge(node.id, childId);
	}
	dagre.layout(graph);
	return {
		nodes: plan.nodes.map((node) => {
			const point = graph.node(node.id);
			return {
				id: node.id,
				type: "plan",
				position: { x: point.x - 119, y: point.y - 66 },
				data: {
					node,
					findings: findings.filter((item) => item.nodeId === node.id),
					onOpen,
					category: nodeCategory(node),
				},
			};
		}),
		edges: plan.nodes.flatMap((node) =>
			node.childIds.map((childId) => ({
				id: `${node.id}-${childId}`,
				source: node.id,
				target: childId,
				label: plan.nodeById[childId]?.parentRelationship,
				style: { stroke: "var(--color-ink-3)" },
			})),
		),
	};
}

function App() {
	const [database, setDatabase] = useState<PlanDatabase>(() => {
		if (typeof window === "undefined") return "postgresql";
		return window.localStorage.getItem(PLAN_DATABASE_KEY) === "mysql"
			? "mysql"
			: "postgresql";
	});
	const [input, setInput] = useState(() =>
		typeof window === "undefined" ? "" : "",
	);
	const [plan, setPlan] = useState<ExecutionPlan | null>(null);
	const [error, setError] = useState<PlanParseError | null>(null);
	const [selected, setSelected] = useState<PlanNode | null>(null);
	const [activeFinding, setActiveFinding] = useState<PlanFinding | null>(null);
	const [mobilePane, setMobilePane] = useState<"input" | "plan" | "findings">(
		"input",
	);
	const [examplesOpen, setExamplesOpen] = useState(true);
	const [activeExample, setActiveExample] = useState<PlanExample | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [aboutOpen, setAboutOpen] = useState(false);
	const [aboutClosing, setAboutClosing] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	const [desktop, setDesktop] = useState(() =>
		typeof window === "undefined"
			? true
			: window.matchMedia("(min-width: 768px)").matches,
	);
	const { fitView, setCenter } = useReactFlow();
	const findings = useMemo(() => (plan ? analyzePlan(plan) : []), [plan]);
	const bottlenecks = useMemo(
		() => (plan ? rankPlanBottlenecks(plan) : []),
		[plan],
	);
	const bottleneckCount = bottlenecks.reduce(
		(total, section) => total + section.items.length,
		0,
	);
	const examples = useMemo(
		() => ALL_PLAN_EXAMPLES.filter((example) => example.database === database),
		[database],
	);
	const currentSql =
		typeof window === "undefined"
			? ""
			: (window.localStorage.getItem(CURRENT_SQL_KEY) ?? "");

	useEffect(() => setHydrated(true), []);

	useEffect(() => {
		window.localStorage.setItem(PLAN_DATABASE_KEY, database);
		setInput(window.localStorage.getItem(planInputKey(database)) ?? "");
		setPlan(null);
		setError(null);
		setSelected(null);
		setActiveFinding(null);
		setActiveExample(null);
	}, [database]);

	useEffect(() => {
		const media = window.matchMedia("(min-width: 768px)");
		const update = () => setDesktop(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (!input.trim()) {
			setPlan(null);
			setError(null);
			return;
		}
		const timer = setTimeout(() => {
			try {
				setPlan(
					database === "mysql"
						? parseMysqlPlan(input)
						: parsePostgresPlan(input),
				);
				setError(null);
				setSelected(null);
				window.localStorage.setItem(planInputKey(database), input);
			} catch (nextError) {
				setPlan(null);
				setError(
					nextError instanceof PlanParseError
						? nextError
						: new PlanParseError(
								"invalid-structure",
								"This plan could not be read.",
							),
				);
			}
		}, 220);
		return () => clearTimeout(timer);
	}, [input, database]);

	const openNode = useCallback((node: PlanNode) => {
		setSelected(node);
	}, []);
	const graph = useMemo(
		() => (plan ? layout(plan, findings, openNode) : { nodes: [], edges: [] }),
		[plan, findings, openNode],
	);
	useEffect(() => {
		if (!plan) return;
		const timer = setTimeout(() => fitView({ padding: 0.18, maxZoom: 1 }), 50);
		return () => clearTimeout(timer);
	}, [plan, fitView]);

	const selectFinding = useCallback(
		(item: PlanFinding) => {
			if (!plan) return;
			const node = plan.nodeById[item.nodeId];
			if (!node) return;
			setActiveFinding(item);
			setSelected(node);
			setMobilePane("plan");
			const rendered = graph.nodes.find(
				(candidate) => candidate.id === node.id,
			);
			if (rendered)
				setCenter(rendered.position.x + 119, rendered.position.y + 66, {
					zoom: 1,
					duration: 350,
				});
		},
		[plan, graph.nodes, setCenter],
	);

	const selectBottleneck = useCallback(
		(item: PlanBottleneckItem) => {
			if (!plan) return;
			const node = plan.nodeById[item.nodeId];
			if (!node) return;
			setActiveFinding(null);
			setSelected(node);
			setMobilePane("plan");
			const rendered = graph.nodes.find(
				(candidate) => candidate.id === node.id,
			);
			if (rendered)
				setCenter(rendered.position.x + 119, rendered.position.y + 66, {
					zoom: 1,
					duration: 350,
				});
		},
		[plan, graph.nodes, setCenter],
	);

	const loadExample = (example: PlanExample) => {
		setInput(example.json);
		setActiveExample(example);
		setMobilePane("plan");
	};
	const closeAbout = useCallback(() => {
		setAboutClosing(true);
		setTimeout(() => {
			setAboutOpen(false);
			setAboutClosing(false);
		}, CLOSE_MS);
	}, []);
	const clear = () => {
		setInput("");
		setPlan(null);
		setError(null);
		setSelected(null);
		setActiveFinding(null);
		setActiveExample(null);
		window.localStorage.removeItem(planInputKey(database));
	};
	const copyWithStatus = async (id: string, value: string) => {
		try {
			await copy(value);
			setCopied(id);
			setTimeout(() => setCopied(null), 1400);
		} catch {
			setCopied(null);
		}
	};
	const root = plan ? plan.nodeById[plan.rootId] : undefined;
	const counts = {
		danger: findings.filter((item) => item.severity === "danger").length,
		warning: findings.filter((item) => item.severity === "warning").length,
		info: findings.filter((item) => item.severity === "info").length,
	};
	const sqlCommand =
		database === "mysql"
			? currentSql
				? `EXPLAIN FORMAT=JSON\n${currentSql.trim()}`
				: mysqlEstimatedCommand
			: currentSql
				? `EXPLAIN (FORMAT JSON)\n${currentSql.trim()}`
				: postgresEstimatedCommand;
	const postgresAnalyzedSql = currentSql
		? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\n${currentSql.trim()}`
		: postgresAnalyzedCommand;
	const currentSqlMayWrite =
		Boolean(currentSql.trim()) && !/^(select|with\s)/i.test(currentSql.trim());
	const databaseName = database === "mysql" ? "MySQL" : "PostgreSQL";
	const rootCost =
		root?.totalCost ?? root?.queryCost ?? root?.prefixCost ?? root?.readCost;
	const rootRows =
		database === "mysql"
			? (root?.rowsProducedPerJoin ??
				root?.rowsExaminedPerScan ??
				root?.planRows)
			: plan?.analyzed
				? root?.actualRows
				: root?.planRows;

	return (
		<div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-paper text-ink">
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-2.5 py-2 md:flex-nowrap md:gap-3 md:px-4 md:py-2.5">
				<div className="flex min-w-0 flex-1 items-center gap-2 md:shrink-0 md:gap-2.5">
					<img
						src="/logo192.png"
						alt=""
						className="h-8 w-8 shrink-0 object-contain md:h-9 md:w-9"
						width={36}
						height={36}
					/>
					<h1 className="sr-only sm:not-sr-only sm:font-display sm:text-[1.3rem] sm:leading-none sm:font-semibold sm:tracking-[-0.035em] sm:text-ink">
						QueryGraph
					</h1>
					<p className="hidden text-xs text-ink-4 xl:block">
						Read SQL like a flowchart
					</p>
					<nav
						aria-label="Product mode"
						className="ml-0 flex min-w-0 rounded border border-rule bg-paper-2 p-0.5 sm:ml-1"
					>
						<Link
							to="/"
							className="rounded px-2 py-2 font-mono text-[0.6rem] whitespace-nowrap text-ink-3 hover:text-ink sm:px-2.5 md:py-1.5 md:text-[0.65rem]"
						>
							Query Logic
						</Link>
						<Link
							to="/explain"
							className="rounded bg-paper px-2 py-2 font-mono text-[0.6rem] whitespace-nowrap text-accent shadow-sm sm:px-2.5 md:py-1.5 md:text-[0.65rem]"
							aria-current="page"
						>
							Execution Plan
						</Link>
					</nav>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
					<div className="hidden items-center gap-2 font-mono text-[.62rem] text-ink-4 md:flex">
						<Database size={13} />{" "}
						{database === "mysql" ? "MySQL" : "PostgreSQL"} · processed locally
					</div>
					<button
						type="button"
						onClick={() => {
							setAboutClosing(false);
							setAboutOpen(true);
						}}
						title="About"
						aria-label="About"
						className="flex h-10 items-center gap-1.5 rounded px-2 font-mono text-[0.75rem] text-ink-2 transition hover:bg-paper-2 hover:text-ink md:h-9 md:px-3"
					>
						<CircleHelp size={15} />
						<span className="hidden sm:inline">About</span>
					</button>
				</div>
			</header>

			<nav
				aria-label="Execution plan views"
				className="grid shrink-0 grid-cols-3 border-b border-rule md:hidden"
			>
				{(["input", "plan", "findings"] as const).map((pane) => (
					<button
						key={pane}
						type="button"
						onClick={() => setMobilePane(pane)}
						data-active={mobilePane === pane}
						className="h-11 border-r border-rule font-mono text-[.65rem] tracking-wide uppercase data-[active=true]:bg-paper-2 data-[active=true]:text-accent"
					>
						{pane}
						{pane === "findings" && (findings.length || bottleneckCount)
							? ` (${bottleneckCount + findings.length})`
							: ""}
					</button>
				))}
			</nav>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<section
					data-active={mobilePane === "input"}
					className="flex w-full flex-col border-r border-rule data-[active=false]:hidden md:flex md:w-[34%] md:max-w-[29rem] md:data-[active=false]:flex"
				>
					<div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2 sm:px-4">
						<div className="min-w-0">
							<p className="font-mono text-[.62rem] tracking-widest text-ink-3 uppercase">
								{database === "mysql" ? "MySQL JSON" : "PostgreSQL JSON"}
							</p>
							<p className="mt-0.5 text-[.68rem] text-ink-4">
								No upload or database connection
							</p>
						</div>
						<button
							type="button"
							onClick={clear}
							disabled={!hydrated}
							className="flex h-9 shrink-0 items-center gap-1.5 rounded px-2 font-mono text-[.62rem] text-ink-3 hover:bg-paper-2"
							data-testid="clear-plan"
						>
							<RotateCcw size={13} /> Clear
						</button>
					</div>
					<div className="border-b border-rule px-3 py-2 sm:px-4">
						<fieldset
							aria-label="Plan database"
							className="grid grid-cols-2 rounded border border-rule bg-paper-2 p-0.5"
						>
							{(
								[
									["postgresql", "PostgreSQL"],
									["mysql", "MySQL"],
								] as const
							).map(([value, label]) => (
								<button
									key={value}
									type="button"
									onClick={() => setDatabase(value)}
									disabled={!hydrated}
									data-active={database === value}
									className="h-8 rounded font-mono text-[.62rem] text-ink-3 disabled:cursor-wait disabled:opacity-60 data-[active=true]:bg-paper data-[active=true]:text-accent data-[active=true]:shadow-sm"
								>
									{label}
								</button>
							))}
						</fieldset>
					</div>
					{activeExample ? (
						<div className="border-b border-rule bg-paper-2 px-4 py-2">
							<p className="font-mono text-[.58rem] text-accent uppercase">
								Example · {activeExample.title}
							</p>
							<p className="mt-1 text-xs text-ink-3">{activeExample.notice}</p>
						</div>
					) : null}
					{error ? (
						<div
							role="alert"
							className="border-b border-accent/30 bg-accent/10 px-4 py-3 text-xs leading-relaxed text-accent-2"
							data-testid="plan-error"
						>
							<p className="font-semibold">{error.message}</p>
							<p className="mt-1">
								Generate compatible output with:{" "}
								<code className="font-mono">
									{database === "mysql"
										? "EXPLAIN FORMAT=JSON SELECT ...;"
										: "EXPLAIN (FORMAT JSON) SELECT ...;"}
								</code>
							</p>
							{error.technicalDetail ? (
								<details className="mt-2">
									<summary className="cursor-pointer">Technical detail</summary>
									<p className="mt-1 font-mono text-[.65rem]">
										{error.technicalDetail}
									</p>
								</details>
							) : null}
						</div>
					) : null}
					{plan ? (
						<output
							className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2 font-mono text-[.62rem] text-teal-2"
							data-testid="plan-status"
						>
							<CheckCircle2 size={14} />{" "}
							{plan.database === "mysql" ? "MySQL" : "PostgreSQL"} ·{" "}
							{plan.analyzed
								? plan.database === "mysql"
									? "Runtime JSON"
									: "EXPLAIN ANALYZE"
								: "Estimated plan"}{" "}
							· {plan.nodes.length} nodes
							{plan.hasBuffers ? " · Buffers included" : ""}
						</output>
					) : null}
					<textarea
						aria-label={
							database === "mysql"
								? "MySQL EXPLAIN JSON"
								: "PostgreSQL EXPLAIN JSON"
						}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						disabled={!hydrated}
						placeholder={
							database === "mysql"
								? 'Paste EXPLAIN FORMAT=JSON output here...\n\n{\n  "query_block": { "table": { "table_name": "orders" } }\n}'
								: 'Paste EXPLAIN (FORMAT JSON) output here...\n\n[\n  { "Plan": { "Node Type": "Seq Scan", ... } }\n]'
						}
						spellCheck={false}
						className="min-h-[12rem] flex-1 resize-none bg-paper p-3 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:p-4 md:min-h-[13rem]"
						data-testid="plan-input"
					/>
					<div
						data-open={examplesOpen}
						className="max-h-14 shrink-0 overflow-hidden border-t border-rule bg-paper transition-[max-height] duration-200 data-[open=true]:max-h-[30dvh] data-[open=true]:overflow-y-auto md:max-h-14 md:data-[open=true]:max-h-[36%] md:data-[open=true]:overflow-y-auto"
					>
						<button
							type="button"
							onClick={() => setExamplesOpen((open) => !open)}
							disabled={!hydrated}
							aria-expanded={examplesOpen}
							aria-controls="plan-examples-list"
							className="flex h-14 w-full items-center justify-between gap-3 px-3 text-left disabled:cursor-wait disabled:opacity-60 md:px-3"
						>
							<span className="flex min-w-0 items-center gap-2">
								<BookOpen size={14} className="shrink-0 text-ink-4" />
								<span className="font-mono text-[.6rem] tracking-widest text-ink-3 uppercase">
									Examples
								</span>
							</span>
							<span className="flex items-center gap-1.5 font-mono text-[.58rem] text-ink-4 uppercase">
								{examplesOpen ? "Hide" : "Show"}
								{examplesOpen ? (
									<ChevronDown size={14} />
								) : (
									<ChevronUp size={14} />
								)}
							</span>
						</button>
						{examplesOpen ? (
							<div
								id="plan-examples-list"
								className="grid grid-cols-1 gap-1.5 px-3 pb-3 min-[420px]:grid-cols-2 md:mt-2"
							>
								{examples.map((example) => (
									<button
										key={example.id}
										type="button"
										onClick={() => loadExample(example)}
										disabled={!hydrated}
										data-testid={`plan-example-${example.id}`}
										className="min-h-10 rounded border border-rule px-2 py-1.5 text-left text-[.68rem] leading-tight text-ink-2 hover:border-ink-4 hover:bg-paper-2"
									>
										{example.title}
									</button>
								))}
							</div>
						) : null}
					</div>
				</section>

				<main
					data-active={mobilePane === "plan"}
					className="relative min-w-0 flex-1 data-[active=false]:hidden data-[active=true]:flex data-[active=true]:flex-col md:flex md:flex-col md:data-[active=false]:flex"
				>
					{plan && root ? (
						<>
							<div
								className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-3 py-2 text-[0.7rem] sm:px-4 sm:text-xs"
								data-testid="plan-overview"
							>
								<strong className="font-mono text-[.64rem] tracking-wide text-teal-2 uppercase">
									{plan.analyzed ? "Actual execution" : "Estimated plan"}
								</strong>
								<span>
									{plan.analyzed
										? `Execution ${plan.executionTime !== undefined ? `${formatNumber(plan.executionTime)} ms` : "time unavailable"}`
										: `Root cost ${rootCost ?? "—"}`}
								</span>
								{plan.planningTime !== undefined ? (
									<span>Planning {formatNumber(plan.planningTime)} ms</span>
								) : null}
								<span>
									{plan.analyzed ? "Root actual" : "Root estimated"} rows{" "}
									{formatNumber(rootRows ?? 0)}
								</span>
								<span>
									{plan.nodes.length} nodes · depth {plan.maxDepth}
								</span>
								<span>
									{counts.danger} danger · {counts.warning} warning ·{" "}
									{counts.info} info
								</span>
								<span>
									{plan.hasBuffers ? "Buffers included" : "No buffer metrics"}
								</span>
							</div>
							<p className="shrink-0 border-b border-rule-soft px-3 py-1.5 text-center text-[.65rem] leading-snug text-ink-4 sm:px-4 sm:text-[.68rem]">
								Read from the leaves upward to follow how rows are produced for
								parent operations.
							</p>
							<div className="min-h-0 flex-1">
								{desktop || mobilePane === "plan" ? (
									<ReactFlow
										nodes={graph.nodes.map((node) => ({
											...node,
											selected:
												node.id === selected?.id ||
												node.id === activeFinding?.nodeId,
										}))}
										edges={graph.edges}
										nodeTypes={nodeTypes}
										nodesDraggable={false}
										fitView
										minZoom={0.1}
										maxZoom={1.6}
										aria-label={`${databaseName} execution plan tree`}
									>
										<Background
											variant={BackgroundVariant.Dots}
											gap={24}
											size={1}
										/>
										<Controls showInteractive={false} />
									</ReactFlow>
								) : null}
							</div>
						</>
					) : (
						<div
							className="h-full overflow-y-auto p-4 sm:p-5 md:p-8"
							data-testid="explain-empty-state"
						>
							<div className="mx-auto max-w-3xl">
								<p className="font-mono text-[.65rem] tracking-widest text-accent uppercase">
									{databaseName} execution plans
								</p>
								<h2 className="mt-2 max-w-2xl font-display text-2xl font-semibold leading-tight sm:text-3xl">
									{database === "mysql"
										? "See how MySQL plans your query."
										: "See how PostgreSQL plans or actually executes your query."}
								</h2>
								<p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-3">
									Paste JSON produced by {databaseName}. QueryGraph parses and
									analyzes it entirely in this browser; it does not execute SQL,
									connect to a database, or send the plan elsewhere.
								</p>
								<div className="mt-6 grid gap-3 md:grid-cols-2">
									<Command
										title={
											database === "mysql"
												? "Estimated MySQL JSON"
												: "Estimated plan"
										}
										description={
											database === "mysql"
												? "Plans without executing the statement. Cost values are optimizer estimates, not milliseconds."
												: "Plans without executing the statement. Cost values are planner units, not milliseconds."
										}
										value={sqlCommand}
										copied={copied === "estimated"}
										onCopy={() => copyWithStatus("estimated", sqlCommand)}
									/>
									{database === "postgresql" ? (
										<Command
											title="Actual runtime + buffers"
											description={
												currentSqlMayWrite
													? "Warning: the current SQL is not a SELECT. ANALYZE will execute it and may modify data."
													: "Executes the statement and records observed timing, rows, loops, and buffers."
											}
											value={postgresAnalyzedSql}
											copied={copied === "analyzed"}
											onCopy={() =>
												copyWithStatus("analyzed", postgresAnalyzedSql)
											}
										/>
									) : (
										<Command
											title="Runtime note"
											description="MySQL EXPLAIN ANALYZE executes the statement and is commonly TREE output in MySQL 8.0/8.4. Paste JSON only if your MySQL version emits JSON analyze output."
											value="EXPLAIN ANALYZE output is version-dependent; QueryGraph accepts JSON only."
											copied={copied === "mysql-runtime-note"}
											onCopy={() =>
												copyWithStatus(
													"mysql-runtime-note",
													"MySQL EXPLAIN ANALYZE executes the statement and is commonly TREE output in MySQL 8.0/8.4. Paste JSON only if your MySQL version emits JSON analyze output.",
												)
											}
										/>
									)}
								</div>
								<div className="mt-4 flex gap-3 rounded border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed text-accent-2">
									<AlertTriangle className="mt-0.5 shrink-0" size={17} />
									{database === "mysql" ? (
										<p>
											MySQL estimated JSON is the reliable baseline here.
											Runtime JSON is accepted only when your MySQL version
											emits JSON analyze output.
										</p>
									) : (
										<p>
											<strong>EXPLAIN ANALYZE executes the statement.</strong>{" "}
											INSERT, UPDATE, DELETE, and functions with side effects
											can modify data.
										</p>
									)}
								</div>
								<div className="mt-5 flex flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap">
									<button
										type="button"
										onClick={() => setMobilePane("input")}
										disabled={!hydrated}
										className="flex h-10 items-center gap-2 rounded bg-ink px-4 font-mono text-xs text-paper hover:bg-ink-2"
									>
										<Clipboard size={15} /> Paste plan
									</button>
									<button
										type="button"
										onClick={() => {
											const example = examples[1] ?? examples[0];
											if (example) loadExample(example);
										}}
										disabled={!hydrated}
										className="flex h-10 items-center gap-2 rounded border border-rule px-4 font-mono text-xs hover:bg-paper-2"
									>
										<FileJson size={15} /> Try an example
									</button>
								</div>
								<p className="mt-6 text-xs leading-relaxed text-ink-4">
									Supported:{" "}
									{database === "mysql"
										? "MySQL EXPLAIN FORMAT=JSON, including JSON copied from common SQL clients, nested_loop, operation wrappers, materialized subqueries, and access-path fields. Not supported: tabular EXPLAIN, TREE text, optimizer trace, or SQL-only input."
										: "PostgreSQL EXPLAIN JSON, including JSON copied from common SQL clients, ANALYZE, BUFFERS, workers, JIT, and triggers. Not supported: text, YAML, XML, MySQL EXPLAIN, or SQL-only input."}{" "}
									Limits: {PLAN_LIMITS.maxInputBytes / 1_000_000} MB,{" "}
									{PLAN_LIMITS.maxNodes} nodes, depth {PLAN_LIMITS.maxDepth}.
								</p>
							</div>
						</div>
					)}
				</main>

				<section
					data-active={mobilePane === "findings"}
					className="w-full overflow-y-auto data-[active=false]:hidden md:block md:w-[21rem] md:border-l md:border-rule md:data-[active=false]:block"
					data-testid="plan-health"
					aria-label="Plan triage"
				>
					<div className="sticky top-0 border-b border-rule bg-paper px-4 py-3">
						<p className="font-mono text-[.62rem] tracking-widest text-ink-3 uppercase">
							Plan Triage
						</p>
						<p className="mt-1 text-xs text-ink-4">
							{plan
								? `${bottleneckCount} ranked bottleneck${bottleneckCount === 1 ? "" : "s"} · ${findings.length} finding${findings.length === 1 ? "" : "s"}`
								: "Load a plan to rank bottlenecks"}
						</p>
					</div>
					{plan ? (
						<PlanBottlenecksPanel
							sections={bottlenecks}
							selectedNodeId={selected?.id}
							onSelect={selectBottleneck}
						/>
					) : (
						<div className="flex items-start gap-2 px-4 py-5 text-xs text-ink-4">
							<Info size={15} className="mt-0.5 shrink-0" />
							<p>Load a plan to rank the highest-impact nodes to inspect.</p>
						</div>
					)}
					<div className="space-y-2 border-t border-rule p-3">
						<div className="px-1">
							<h2 className="font-display text-sm font-semibold">
								Plan Health
							</h2>
							<p className="mt-0.5 text-xs text-ink-4">
								{findings.length
									? `${findings.length} evidence-based finding${findings.length === 1 ? "" : "s"}`
									: "No high-confidence issues found"}
							</p>
						</div>
						{findings.map((item, index) => (
							<button
								type="button"
								key={`${item.ruleId}-${item.nodeId}`}
								onClick={() => selectFinding(item)}
								data-testid={`plan-finding-${item.ruleId}`}
								className="w-full rounded border border-rule p-3 text-left hover:border-ink-4 focus-visible:outline-2 focus-visible:outline-accent"
							>
								<div className="flex items-center gap-2">
									<span
										className="font-mono text-[.56rem] uppercase"
										data-severity={item.severity}
									>
										{item.severity}
									</span>
									<strong className="text-xs">{item.title}</strong>
								</div>
								<p className="mt-2 text-xs leading-relaxed text-ink-3">
									{item.evidence}
								</p>
								<p className="mt-2 text-[.68rem] leading-relaxed text-ink-4">
									Investigate · {item.suggestions[0]}
								</p>
								<span className="sr-only">
									Finding {index + 1} of {findings.length}
								</span>
							</button>
						))}
						{!plan ? (
							<div className="py-8 text-center">
								<Info className="mx-auto text-ink-4" size={20} />
								<p className="mt-2 text-xs text-ink-4">
									Load a plan to run deterministic checks.
								</p>
							</div>
						) : null}
					</div>
				</section>
			</div>
			{selected ? (
				<PlanDetailsDrawer
					node={selected}
					findings={findings.filter((item) => item.nodeId === selected.id)}
					onClose={() => setSelected(null)}
				/>
			) : null}
			{aboutOpen && <AboutModal closing={aboutClosing} onClose={closeAbout} />}
		</div>
	);
}

function Command({
	title,
	description,
	value,
	copied,
	onCopy,
}: {
	title: string;
	description: string;
	value: string;
	copied: boolean;
	onCopy: () => void;
}) {
	return (
		<div className="rounded border border-rule bg-paper-2 p-4">
			<div className="flex items-center justify-between">
				<h3 className="font-mono text-xs font-semibold">{title}</h3>
				<button
					type="button"
					onClick={onCopy}
					aria-label={`Copy ${title} command`}
					className="flex h-9 items-center gap-1 rounded px-2 font-mono text-[.62rem] hover:bg-paper"
				>
					{copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<p className="mt-1 text-xs leading-relaxed text-ink-3">{description}</p>
			<pre className="mt-3 whitespace-pre-wrap font-mono text-[.68rem] leading-relaxed text-ink-2">
				{value}
			</pre>
		</div>
	);
}

export function ExecutionPlanApp() {
	return (
		<ReactFlowProvider>
			<App />
		</ReactFlowProvider>
	);
}
