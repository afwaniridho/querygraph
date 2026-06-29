import Editor, { type OnMount } from "@monaco-editor/react";
import {
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	type Node,
	type OnEdgesChange,
	type OnNodesChange,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
	BookOpen,
	Check,
	CircleHelp,
	Copy,
	Database,
	GitBranch,
	Link,
	PanelsTopLeft,
	X,
} from "lucide-react";
import type * as MonacoNS from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AboutModal } from "#/components/AboutModal";
import { ExamplesGallery } from "#/components/ExamplesGallery";
import { NodeDetailsPanel } from "#/components/NodeDetailsPanel";
import { QueryHealthPanel } from "#/components/QueryHealthPanel";
import { RecursiveEdge } from "#/components/RecursiveEdge";
import { SqlNode } from "#/components/SqlNode";
import {
	DDL_STORAGE_KEY,
	DEFAULT_SQL,
	DIALECT_STORAGE_KEY,
	DIALECTS,
	type Dialect,
	isDialect,
} from "#/lib/dialect";
import type { SqlExample } from "#/lib/examples";
import { NodeActionsContext } from "#/lib/node-actions";
import { parseSql } from "#/lib/parse";
import type { SourceSpan } from "#/lib/pipeline";
import {
	analyzeQueryHealth,
	type HealthFinding,
} from "#/lib/query-health/analyze";
import { parseSchema } from "#/lib/schema/parse-schema";
import { createPreviewSummary } from "#/lib/share-preview";
import {
	buildSharePath,
	decodeLegacyShareState,
	type RestorableShareState,
	SHARE_LIMITS,
	ShareLimitError,
	type ShareState,
} from "#/lib/share-url";

const nodeTypes = { sql: SqlNode };
const edgeTypes = { recursive: RecursiveEdge };

const DEBOUNCE_MS = 280;
const CLOSE_MS = 200;
const SHARE_RESET_MS = 1800;

function readStoredDialect(): Dialect {
	if (typeof window === "undefined") return "postgres";
	const stored = window.localStorage.getItem(DIALECT_STORAGE_KEY);
	return isDialect(stored) ? stored : "postgres";
}

function readStoredDdl(): Record<Dialect, string> {
	const empty: Record<Dialect, string> = { postgres: "", mysql: "" };
	if (typeof window === "undefined") return empty;
	try {
		const raw = window.localStorage.getItem(DDL_STORAGE_KEY);
		if (!raw) return empty;
		const parsed = JSON.parse(raw) as Partial<Record<Dialect, string>>;
		return {
			postgres: parsed.postgres ?? "",
			mysql: parsed.mysql ?? "",
		};
	} catch {
		return empty;
	}
}

function readSharedStateFromHash(): RestorableShareState | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash.replace(/^#/, "");
	if (!hash) return null;
	const value = new URLSearchParams(hash).get("q");
	return value ? decodeLegacyShareState(value) : null;
}

function nodeAtOffset(nodes: Node[], offset: number): Node | null {
	let best: Node | null = null;
	let bestSize = Number.POSITIVE_INFINITY;
	for (const n of nodes) {
		const loc = n.data?.loc as SourceSpan | undefined;
		if (!loc) continue;
		if (offset >= loc.start && offset <= loc.end) {
			const size = loc.end - loc.start;
			if (size < bestSize) {
				best = n;
				bestSize = size;
			}
		}
	}
	return best;
}

function GraphStage({
	initialShareState,
	isShared,
}: {
	initialShareState?: RestorableShareState;
	isShared: boolean;
}) {
	const [initialSharedState] = useState<RestorableShareState | null>(() =>
		initialShareState ? initialShareState : readSharedStateFromHash(),
	);
	const [storedDdl] = useState<Record<Dialect, string>>(readStoredDdl);
	const [nodes, setNodes] = useState<Node[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [detailNode, setDetailNode] = useState<Node | null>(null);
	const [panelClosing, setPanelClosing] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);
	const [examplesOpen, setExamplesOpen] = useState(false);
	const [activeExample, setActiveExample] = useState<SqlExample | null>(null);
	const [findings, setFindings] = useState<HealthFinding[]>([]);
	const [selectedFinding, setSelectedFinding] = useState<HealthFinding | null>(
		null,
	);
	const [aboutClosing, setAboutClosing] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
	const [shareStatus, setShareStatus] = useState<
		"idle" | "copied" | "markdown" | "ready" | "error"
	>("idle");
	const [shareUrl, setShareUrl] = useState("");
	const [shareError, setShareError] = useState<string | null>(null);
	const [mobilePane, setMobilePane] = useState<"editor" | "diagram">("editor");
	const [dialect, setDialect] = useState<Dialect>(
		() => initialSharedState?.dialect ?? readStoredDialect(),
	);
	const [autoFitVersion, setAutoFitVersion] = useState(0);
	const [sqlByDialect, setSqlByDialect] = useState<Record<Dialect, string>>(
		() => ({
			...DEFAULT_SQL,
			...(initialSharedState && {
				[initialSharedState.dialect]: initialSharedState.sql,
			}),
		}),
	);
	const [sqlText, setSqlText] = useState(
		() =>
			initialSharedState?.sql ??
			DEFAULT_SQL[initialSharedState?.dialect ?? readStoredDialect()],
	);
	const [ddlByDialect, setDdlByDialect] = useState<Record<Dialect, string>>(
		() => ({
			...storedDdl,
			...(initialSharedState && {
				[initialSharedState.dialect]: initialSharedState.ddl,
			}),
		}),
	);
	const [ddlText, setDdlText] = useState(
		() =>
			initialSharedState?.ddl ??
			storedDdl[initialSharedState?.dialect ?? readStoredDialect()],
	);
	const [schemaOpen, setSchemaOpen] = useState(() =>
		initialSharedState
			? initialSharedState.schemaOpen || Boolean(initialSharedState.ddl.trim())
			: false,
	);
	const [schemaError, setSchemaError] = useState<string | null>(null);
	const [schemaSummary, setSchemaSummary] = useState<string | null>(null);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const shareResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof MonacoNS | null>(null);
	const decorationsRef =
		useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null);
	const nodesRef = useRef<Node[]>([]);
	const suppressProgrammaticChangeRef = useRef(false);
	const suppressCursorRef = useRef(false);

	const { fitView } = useReactFlow();

	useEffect(() => {
		nodesRef.current = nodes;
	}, [nodes]);

	useEffect(() => {
		return () => {
			if (shareResetRef.current) clearTimeout(shareResetRef.current);
		};
	}, []);

	const tieRange = useCallback((loc: SourceSpan) => {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;
		const model = editor.getModel();
		if (!model) return;
		const start = model.getPositionAt(loc.start);
		const end = model.getPositionAt(loc.end);
		decorationsRef.current?.set([
			{
				range: new monaco.Range(
					start.lineNumber,
					start.column,
					end.lineNumber,
					end.column,
				),
				options: {
					className: "qg-source-tie",
					inlineClassName: "qg-source-tie",
					isWholeLine: false,
				},
			},
		]);
	}, []);

	const clearTie = useCallback(() => {
		setActiveId(null);
		decorationsRef.current?.set([]);
	}, []);

	const runParse = useCallback(
		(raw: string, forDialect: Dialect, ddl: string) => {
			clearTie();
			let schema: ReturnType<typeof parseSchema>["schema"] | undefined;
			if (ddl.trim()) {
				const parsed = parseSchema(ddl, forDialect);
				if (parsed.error) {
					setSchemaError(parsed.error);
					setSchemaSummary(null);
				} else {
					setSchemaError(null);
					schema = parsed.schema;
					const tableCount = parsed.schema.tables.size;
					let indexCount = 0;
					for (const t of parsed.schema.tables.values()) {
						indexCount += t.indexes.length;
					}
					setSchemaSummary(
						tableCount
							? `${tableCount} table${tableCount > 1 ? "s" : ""}, ${indexCount} index${indexCount === 1 ? "" : "es"}`
							: null,
					);
				}
			} else {
				setSchemaError(null);
				setSchemaSummary(null);
			}
			const result = parseSql(raw, forDialect, schema);
			if (result.error) {
				setParseError(result.error);
				setFindings([]);
				setSelectedFinding(null);
				return;
			}
			setNodes(result.nodes);
			setEdges(result.edges);
			const nextFindings = analyzeQueryHealth({
				sql: raw,
				dialect: forDialect,
				nodes: result.nodes,
				schema,
			});
			setFindings(nextFindings);
			setSelectedFinding((current) =>
				current
					? (nextFindings.find(
							(item) =>
								item.ruleId === current.ruleId &&
								item.nodeId === current.nodeId,
						) ?? null)
					: null,
			);
			setParseError(null);
			setAutoFitVersion((version) => version + 1);
		},
		[clearTie],
	);

	const applySharedState = useCallback(
		(shared: RestorableShareState) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			setPanelClosing(false);
			setDetailNode(null);
			setDialect(shared.dialect);
			setSqlText(shared.sql);
			setSqlByDialect((prev) => ({
				...prev,
				[shared.dialect]: shared.sql,
			}));
			setDdlText(shared.ddl);
			setDdlByDialect((prev) => ({
				...prev,
				[shared.dialect]: shared.ddl,
			}));
			setSchemaOpen(shared.schemaOpen || Boolean(shared.ddl.trim()));

			const ed = editorRef.current;
			if (ed && ed.getValue() !== shared.sql) {
				suppressProgrammaticChangeRef.current = true;
				try {
					ed.setValue(shared.sql);
				} finally {
					suppressProgrammaticChangeRef.current = false;
				}
			}

			runParse(shared.sql, shared.dialect, shared.ddl);
		},
		[runParse],
	);

	useEffect(() => {
		const onHashChange = () => {
			const shared = readSharedStateFromHash();
			if (shared) applySharedState(shared);
		};
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [applySharedState]);

	// Parse the initial default query once on mount. Later parses run via
	// handleChange (typing) and switchDialect (dialect switch).
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial parse
	useEffect(() => {
		runParse(sqlText, dialect, ddlText);
	}, []);

	useEffect(() => {
		if (nodes.length === 0 || autoFitVersion === 0) return;

		let timeout: ReturnType<typeof setTimeout> | null = null;
		const frame = requestAnimationFrame(() => {
			timeout = setTimeout(() => {
				fitView({ padding: 0.22, duration: 220 });
			}, 40);
		});

		return () => {
			cancelAnimationFrame(frame);
			if (timeout) clearTimeout(timeout);
		};
	}, [autoFitVersion, nodes.length, fitView]);

	useEffect(() => {
		if (mobilePane === "diagram") {
			const t = setTimeout(() => fitView({ padding: 0.22, duration: 220 }), 60);
			return () => clearTimeout(t);
		}
	}, [mobilePane, fitView]);

	const handleChange = useCallback(
		(value: string | undefined) => {
			const next = value ?? "";
			if (suppressProgrammaticChangeRef.current) return;
			setSqlText(next);
			setSqlByDialect((prev) =>
				prev[dialect] === next ? prev : { ...prev, [dialect]: next },
			);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(
				() => runParse(next, dialect, ddlText),
				DEBOUNCE_MS,
			);
		},
		[runParse, dialect, ddlText],
	);

	const switchDialect = useCallback(
		(next: Dialect) => {
			if (next === dialect) return;
			if (debounceRef.current) clearTimeout(debounceRef.current);
			const currentSql = editorRef.current?.getValue() ?? sqlText;
			const nextSql = sqlByDialect[next] ?? DEFAULT_SQL[next];
			setSqlByDialect((prev) => ({
				...prev,
				[dialect]: currentSql,
			}));
			setDialect(next);
			if (typeof window !== "undefined") {
				window.localStorage.setItem(DIALECT_STORAGE_KEY, next);
			}
			setSqlText(nextSql);
			// Push the selected dialect's latest draft into the editor
			// imperatively. The Editor
			// component is uncontrolled (defaultValue), so React state changes
			// alone won't update its contents — and that's intentional: making
			// it controlled causes Monaco to drop rapid keystrokes (including
			// space) because the wrapper calls model.setValue() on every prop
			// change.
			const ed = editorRef.current;
			if (ed && ed.getValue() !== nextSql) {
				suppressProgrammaticChangeRef.current = true;
				try {
					ed.setValue(nextSql);
				} finally {
					suppressProgrammaticChangeRef.current = false;
				}
			}
			// `editor.setValue` fires Monaco's content-change event synchronously,
			// which calls `handleChange` and schedules a debounced parse using the
			// PREVIOUS dialect captured in its closure. Cancel that stale parse
			// before kicking off the correct one, otherwise it fires ~280ms later
			// and overwrites the good result with a wrong-dialect error (e.g.
			// MySQL default backticks parsed as Postgres).
			if (debounceRef.current) clearTimeout(debounceRef.current);
			const nextDdl = ddlByDialect[next] ?? "";
			setDdlByDialect((prev) => ({ ...prev, [dialect]: ddlText }));
			setDdlText(nextDdl);
			runParse(nextSql, next, nextDdl);
		},
		[dialect, runParse, sqlByDialect, sqlText, ddlByDialect, ddlText],
	);

	const handleDdlChange = useCallback(
		(value: string) => {
			setDdlText(value);
			setDdlByDialect((prev) =>
				prev[dialect] === value ? prev : { ...prev, [dialect]: value },
			);
			if (typeof window !== "undefined") {
				window.localStorage.setItem(
					DDL_STORAGE_KEY,
					JSON.stringify({ ...ddlByDialect, [dialect]: value }),
				);
			}
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				const currentSql = editorRef.current?.getValue() ?? sqlText;
				runParse(currentSql, dialect, value);
			}, DEBOUNCE_MS);
		},
		[dialect, ddlByDialect, runParse, sqlText],
	);

	const revealLoc = useCallback((loc: SourceSpan) => {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;
		const model = editor.getModel();
		if (!model) return;
		const start = model.getPositionAt(loc.start);
		const end = model.getPositionAt(loc.end);
		editor.revealRangeInCenter(
			new monaco.Range(
				start.lineNumber,
				start.column,
				end.lineNumber,
				end.column,
			),
		);
	}, []);

	const handleMount: OnMount = useCallback(
		(editor, monaco) => {
			editorRef.current = editor;
			monacoRef.current = monaco;
			decorationsRef.current = editor.createDecorationsCollection([]);

			monaco.editor.defineTheme("querygraph", {
				base: "vs",
				inherit: true,
				rules: [
					{ token: "", foreground: "1a1814" },
					{ token: "keyword.sql", foreground: "b8542a", fontStyle: "bold" },
					{ token: "operator.sql", foreground: "7a3d63" },
					{ token: "string.sql", foreground: "5a6e2c" },
					{ token: "number.sql", foreground: "b8893a" },
					{ token: "comment.sql", foreground: "a39a8a", fontStyle: "italic" },
					{ token: "identifier.sql", foreground: "1f6b6b" },
					{ token: "delimiter.sql", foreground: "6b6357" },
				],
				colors: {
					"editor.background": "#f7f3ec",
					"editor.foreground": "#1a1814",
					"editorLineNumber.foreground": "#a39a8a",
					"editorLineNumber.activeForeground": "#3a342a",
					"editor.lineHighlightBackground": "#efe9dd80",
					"editor.selectionBackground": "#b8542a33",
					"editorCursor.foreground": "#b8542a",
					"editorGutter.background": "#f7f3ec",
				},
			});
			monaco.editor.setTheme("querygraph");

			// Monaco routes typing through a hidden <textarea>. macOS system
			// features (autocorrect, smart quotes/dashes, "double-space inserts
			// period") and browser spellcheck read these attributes from the
			// textarea and can mangle plain typing — e.g. swallowing spaces or
			// replacing two spaces with ". ". Disable every substitution on
			// the hidden input, and re-apply each time Monaco re-renders the
			// textarea (the element can be recreated on layout changes).
			const disableSmartTextOn = (
				root: HTMLElement | null | undefined,
			): void => {
				const ta = root?.querySelector("textarea");
				if (!ta) return;
				ta.setAttribute("autocorrect", "off");
				ta.setAttribute("autocapitalize", "off");
				ta.setAttribute("autocomplete", "off");
				ta.setAttribute("spellcheck", "false");
				ta.setAttribute("data-gramm", "false");
				ta.setAttribute("data-gramm_editor", "false");
				ta.setAttribute("data-enable-grammarly", "false");
			};
			const dom = editor.getDomNode();
			disableSmartTextOn(dom);
			if (dom) {
				const observer = new MutationObserver(() => disableSmartTextOn(dom));
				observer.observe(dom, { childList: true, subtree: true });
				editor.onDidDispose(() => observer.disconnect());
			}

			editor.onDidChangeCursorPosition((e) => {
				if (suppressCursorRef.current) return;
				if (e.reason !== 3) return;
				const model = editor.getModel();
				if (!model) return;
				const offset = model.getOffsetAt(e.position);
				const match = nodeAtOffset(nodesRef.current, offset);
				if (match) {
					setActiveId(match.id);
					const loc = match.data?.loc as SourceSpan | undefined;
					if (loc) tieRange(loc);
				} else {
					clearTie();
				}
			});
		},
		[tieRange, clearTie],
	);

	const focusNode = useCallback(
		(node: Node) => {
			setActiveId(node.id);
			const loc = node.data?.loc as SourceSpan | undefined;
			if (loc) {
				suppressCursorRef.current = true;
				tieRange(loc);
				revealLoc(loc);
				requestAnimationFrame(() => {
					suppressCursorRef.current = false;
				});
			}
		},
		[tieRange, revealLoc],
	);

	const selectFinding = useCallback(
		(finding: HealthFinding) => {
			setSelectedFinding(finding);
			setMobilePane("editor");
			if (finding.sourceSpan) {
				tieRange(finding.sourceSpan);
				revealLoc(finding.sourceSpan);
				const editor = editorRef.current;
				const monaco = monacoRef.current;
				const model = editor?.getModel();
				if (editor && monaco && model) {
					const start = model.getPositionAt(finding.sourceSpan.start);
					const end = model.getPositionAt(finding.sourceSpan.end);
					editor.setSelection(
						new monaco.Range(
							start.lineNumber,
							start.column,
							end.lineNumber,
							end.column,
						),
					);
				}
			}
			if (finding.nodeId) {
				const node = nodesRef.current.find(
					(candidate) => candidate.id === finding.nodeId,
				);
				if (node) focusNode(node);
			}
		},
		[focusNode, revealLoc, tieRange],
	);

	const loadExample = useCallback(
		(example: SqlExample) => {
			const ddl = example.ddl ?? "";
			if (debounceRef.current) clearTimeout(debounceRef.current);
			setExamplesOpen(false);
			setActiveExample(example);
			setDialect(example.dialect);
			setSqlText(example.sql);
			setSqlByDialect((prev) => ({
				...prev,
				[example.dialect]: example.sql,
			}));
			setDdlText(ddl);
			setDdlByDialect((prev) => ({ ...prev, [example.dialect]: ddl }));
			setSchemaOpen(Boolean(ddl));
			window.localStorage.setItem(DIALECT_STORAGE_KEY, example.dialect);
			const editor = editorRef.current;
			if (editor) {
				suppressProgrammaticChangeRef.current = true;
				try {
					editor.setValue(example.sql);
				} finally {
					suppressProgrammaticChangeRef.current = false;
				}
			}
			if (debounceRef.current) clearTimeout(debounceRef.current);
			runParse(example.sql, example.dialect, ddl);
		},
		[runParse],
	);

	const handleNodeClick = useCallback(
		(_: React.MouseEvent, node: Node) => focusNode(node),
		[focusNode],
	);

	const openDetails = useCallback(
		(nodeId: string) => {
			const node = nodesRef.current.find((n) => n.id === nodeId);
			if (!node) return;
			setPanelClosing(false);
			setDetailNode(node);
			focusNode(node);
		},
		[focusNode],
	);

	const closePanel = useCallback(() => {
		if (!detailNode || panelClosing) return;
		setPanelClosing(true);
		setTimeout(() => {
			setDetailNode(null);
			setPanelClosing(false);
		}, CLOSE_MS);
	}, [detailNode, panelClosing]);

	const closeAbout = useCallback(() => {
		setAboutClosing(true);
		setTimeout(() => {
			setAboutOpen(false);
			setAboutClosing(false);
		}, CLOSE_MS);
	}, []);

	const onNodesChange: OnNodesChange = useCallback(
		(changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
		[],
	);
	const onEdgesChange: OnEdgesChange = useCallback(
		(changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
		[],
	);

	const createShareUrl = useCallback(() => {
		if (typeof window === "undefined") return;
		const currentSql = editorRef.current?.getValue() ?? sqlText;
		const payload: ShareState = {
			v: 2,
			dialect,
			sql: currentSql,
			ddl: ddlText,
			schemaOpen,
			preview: createPreviewSummary(nodes, findings),
		};
		const url = new URL(buildSharePath(payload), window.location.origin);
		if (url.toString().length > SHARE_LIMITS.urlCharacters) {
			throw new ShareLimitError("url-too-large");
		}
		setShareUrl(url.toString());
		return { url: url.toString() };
	}, [dialect, ddlText, schemaOpen, sqlText, nodes, findings]);

	const copyShareValue = useCallback(
		async (format: "url" | "markdown") => {
			setShareError(null);
			let generated: ReturnType<typeof createShareUrl>;
			try {
				generated = createShareUrl();
			} catch (error) {
				const message =
					error instanceof ShareLimitError
						? "This query is too large for a self-contained link. Keep your editor open, then copy the SQL directly or remove unused schema DDL."
						: "QueryGraph could not create this share link.";
				setShareError(message);
				setShareStatus("error");
				return;
			}
			if (!generated) return;
			const value =
				format === "markdown"
					? `[QueryGraph shared SQL visualization](${generated.url})`
					: generated.url;
			let copied = false;
			try {
				if (!window.navigator.clipboard?.writeText) {
					throw new Error("Clipboard unavailable");
				}
				await window.navigator.clipboard.writeText(value);
				copied = true;
			} catch {
				copied = false;
			}

			setShareStatus(
				copied ? (format === "markdown" ? "markdown" : "copied") : "ready",
			);
			if (shareResetRef.current) clearTimeout(shareResetRef.current);
			shareResetRef.current = setTimeout(() => {
				setShareStatus("idle");
				shareResetRef.current = null;
			}, SHARE_RESET_MS);
		},
		[createShareUrl],
	);

	const handleShare = useCallback(() => {
		setShareError(null);
		setShareStatus("idle");
		setShareOpen(true);
	}, []);

	const copyFallback = useCallback(async () => {
		try {
			if (!window.navigator.clipboard?.writeText) return;
			await window.navigator.clipboard.writeText(shareUrl);
			setShareStatus("copied");
		} catch {
			setShareStatus("ready");
		}
	}, [shareUrl]);

	const decoratedNodes = useMemo(() => {
		return nodes.map((n) =>
			n.id === activeId ? { ...n, selected: true } : { ...n, selected: false },
		);
	}, [nodes, activeId]);

	const nodeActions = useMemo(() => ({ openDetails }), [openDetails]);

	return (
		<NodeActionsContext.Provider value={nodeActions}>
			<div className="flex h-dvh w-full flex-col bg-paper">
				<header className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-2.5">
					<div className="flex shrink-0 items-center gap-2.5">
						<img
							src="/logo192.png"
							alt=""
							className="h-9 w-9 object-contain"
							width={36}
							height={36}
						/>
						<h1 className="font-display text-[1.3rem] font-semibold leading-none tracking-[-0.035em] text-ink">
							QueryGraph
						</h1>
						<p className="hidden text-xs text-ink-4 sm:block">
							Read SQL like a flowchart
						</p>
					</div>
					<div className="ml-auto flex items-center gap-1">
						<button
							type="button"
							onClick={() => setExamplesOpen(true)}
							data-testid="open-examples"
							className="flex h-9 items-center gap-1.5 rounded px-3 font-mono text-[0.75rem] text-ink-2 transition hover:bg-paper-2 hover:text-ink"
						>
							<BookOpen size={15} />
							Examples
						</button>
						<button
							type="button"
							onClick={handleShare}
							aria-haspopup="dialog"
							className="flex h-9 items-center gap-1.5 rounded px-3 font-mono text-[0.75rem] text-ink-2 transition hover:bg-paper-2 hover:text-ink"
						>
							<Link size={15} />
							Share
						</button>
						<button
							type="button"
							onClick={() => {
								setAboutClosing(false);
								setAboutOpen(true);
							}}
							className="flex h-9 items-center gap-1.5 rounded px-3 font-mono text-[0.75rem] text-ink-2 transition hover:bg-paper-2 hover:text-ink"
						>
							<CircleHelp size={15} />
							About
						</button>
					</div>
				</header>
				{isShared ? (
					<div
						data-testid="shared-query-indicator"
						className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-rule bg-paper-2 px-4 py-1.5 text-center text-xs text-ink-3"
					>
						<span className="font-mono tracking-wide text-teal-2 uppercase">
							Shared query
						</span>
						<span>
							Edit this query freely — changes affect only your local copy.
						</span>
						<span>Analysis still runs in your browser.</span>
					</div>
				) : null}

				<div className="relative flex min-h-0 flex-1">
					<section
						data-active={mobilePane === "editor"}
						className="flex w-full min-w-0 flex-col border-r border-rule data-[active=false]:hidden md:flex md:w-[38%] md:max-w-[34rem] md:data-[active=false]:flex"
					>
						<div className="flex items-center justify-between border-b border-rule px-4 py-2">
							<div className="flex items-center gap-0.5 rounded-sm border border-rule bg-paper-2 p-0.5">
								{DIALECTS.map((d) => (
									<button
										key={d.id}
										type="button"
										onClick={() => switchDialect(d.id)}
										data-on={dialect === d.id}
										className="rounded-[3px] px-2.5 py-1 font-mono text-[0.625rem] tracking-widest uppercase transition data-[on=false]:text-ink-4 data-[on=false]:hover:text-ink-2 data-[on=true]:bg-paper data-[on=true]:text-accent data-[on=true]:shadow-sm"
									>
										{d.label}
									</button>
								))}
							</div>
							<button
								type="button"
								onClick={() => setSchemaOpen((v) => !v)}
								data-on={schemaOpen}
								className="flex items-center gap-1.5 rounded-sm border border-rule px-2 py-1 font-mono text-[0.625rem] tracking-wide uppercase transition data-[on=false]:text-ink-4 data-[on=false]:hover:text-ink-2 data-[on=true]:border-teal data-[on=true]:text-teal-2"
								title="Add CREATE TABLE / INDEX DDL to see index-aware access paths"
							>
								<Database size={12} />
								Schema
								{schemaSummary ? (
									<span className="ml-0.5 rounded-sm bg-paper-3 px-1 text-teal-2">
										{schemaSummary}
									</span>
								) : null}
							</button>
						</div>
						{activeExample && (
							<div
								className="border-b border-rule bg-paper-2 px-4 py-2"
								data-testid="active-example"
							>
								<p className="font-mono text-[0.5625rem] tracking-wide text-accent uppercase">
									Clinic case · {activeExample.title}
								</p>
								<p className="mt-0.5 text-xs leading-snug text-ink-3">
									{activeExample.objective}
								</p>
							</div>
						)}
						{schemaOpen && (
							<div className="flex min-h-[7rem] flex-col border-b border-rule bg-paper-2">
								<div className="flex items-center justify-between px-4 py-1.5">
									<span className="font-mono text-[0.625rem] tracking-wide text-ink-4 uppercase">
										Schema DDL — optional
									</span>
									<span className="font-mono text-[0.5625rem] text-ink-4">
										CREATE TABLE / INDEX → index-aware paths
									</span>
								</div>
								{schemaError && (
									<div
										className="border-y px-4 py-1.5 font-mono text-[0.6875rem] leading-snug"
										style={{
											color: "var(--color-accent-2)",
											background:
												"color-mix(in srgb, var(--color-accent) 10%, transparent)",
										}}
									>
										{schemaError}
									</div>
								)}
								<textarea
									value={ddlText}
									onChange={(e) => handleDdlChange(e.target.value)}
									aria-label="Schema DDL"
									spellCheck={false}
									autoCorrect="off"
									autoCapitalize="off"
									placeholder={
										"CREATE TABLE users (\n  id int PRIMARY KEY,\n  email varchar(255) UNIQUE\n);\nCREATE INDEX idx_org ON users (org_id);"
									}
									className="min-h-[7rem] w-full flex-1 resize-y bg-paper px-4 py-2 font-mono text-[0.75rem] leading-relaxed text-ink outline-none placeholder:text-ink-4"
								/>
							</div>
						)}
						{parseError && (
							<div
								className="border-b px-4 py-2 font-mono text-[0.75rem] leading-snug"
								style={{
									color: "var(--color-accent-2)",
									background:
										"color-mix(in srgb, var(--color-accent) 12%, transparent)",
									borderColor:
										"color-mix(in srgb, var(--color-accent) 30%, transparent)",
									animation: "qg-fade-in 0.2s ease",
								}}
							>
								{parseError}
							</div>
						)}
						<div
							className="min-h-0 flex-1"
							data-source-linked={Boolean(selectedFinding?.sourceSpan)}
						>
							<Editor
								height="100%"
								defaultLanguage="sql"
								defaultValue={sqlText}
								onChange={handleChange}
								onMount={handleMount}
								options={{
									fontFamily: "'JetBrains Mono', ui-monospace, monospace",
									fontSize: 13,
									lineHeight: 21,
									minimap: { enabled: false },
									scrollBeyondLastLine: false,
									padding: { top: 16, bottom: 16 },
									renderLineHighlight: "line",
									smoothScrolling: true,
									tabSize: 2,
									wordWrap: "on",
									overviewRulerLanes: 0,
									scrollbar: { verticalScrollbarSize: 10 },
									// Disable suggestion popup behaviors that swallow / hijack
									// space and other plain typing keys. The built-in SQL
									// snippets (e.g. keyword expansions) were intercepting
									// space presses and producing accidental insertions like
									// `do.` when users were trying to type a space.
									quickSuggestions: false,
									suggestOnTriggerCharacters: false,
									acceptSuggestionOnEnter: "off",
									acceptSuggestionOnCommitCharacter: false,
									tabCompletion: "off",
									wordBasedSuggestions: "off",
									snippetSuggestions: "none",
									parameterHints: { enabled: false },
									autoClosingBrackets: "never",
									autoClosingQuotes: "never",
									autoSurround: "never",
									autoIndent: "none",
									formatOnType: false,
									formatOnPaste: false,
								}}
							/>
						</div>
						<QueryHealthPanel
							findings={findings}
							selected={selectedFinding}
							onSelect={selectFinding}
						/>
					</section>

					<section
						data-active={mobilePane === "diagram"}
						className="relative min-w-0 flex-1 data-[active=false]:hidden md:block md:data-[active=false]:block"
					>
						<ReactFlow
							nodes={decoratedNodes}
							edges={edges}
							nodeTypes={nodeTypes}
							edgeTypes={edgeTypes}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onNodeClick={handleNodeClick}
							onPaneClick={clearTie}
							proOptions={{ hideAttribution: false }}
							fitView
							minZoom={0.2}
							maxZoom={1.6}
							nodesConnectable={false}
							nodesDraggable
							panActivationKeyCode={null}
						>
							<Background
								variant={BackgroundVariant.Cross}
								gap={28}
								size={5}
								color="var(--color-rule)"
							/>
							<Controls showInteractive={false} position="bottom-right" />
						</ReactFlow>

						{detailNode && (
							<div className="absolute top-0 right-0 z-30 h-full w-full max-w-[22rem]">
								<NodeDetailsPanel
									node={detailNode}
									rawSql={sqlText}
									dialect={dialect}
									closing={panelClosing}
									onClose={closePanel}
								/>
							</div>
						)}
					</section>

					<nav className="absolute right-0 bottom-0 left-0 z-40 flex border-t border-rule bg-paper md:hidden">
						<button
							type="button"
							onClick={() => setMobilePane("editor")}
							data-on={mobilePane === "editor"}
							className="flex flex-1 items-center justify-center gap-2 py-3 font-mono text-[0.6875rem] tracking-widest uppercase data-[on=false]:text-ink-4 data-[on=true]:text-accent"
						>
							<PanelsTopLeft size={15} />
							SQL
						</button>
						<button
							type="button"
							onClick={() => setMobilePane("diagram")}
							data-on={mobilePane === "diagram"}
							className="flex flex-1 items-center justify-center gap-2 py-3 font-mono text-[0.6875rem] tracking-widest uppercase data-[on=false]:text-ink-4 data-[on=true]:text-accent"
						>
							<GitBranch size={15} />
							Diagram
						</button>
					</nav>
				</div>
			</div>

			{aboutOpen && <AboutModal closing={aboutClosing} onClose={closeAbout} />}
			{examplesOpen && (
				<ExamplesGallery
					onClose={() => setExamplesOpen(false)}
					onSelect={loadExample}
				/>
			)}
			{shareOpen ? (
				<div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Close share dialog"
						onClick={() => setShareOpen(false)}
						className="absolute inset-0 cursor-default bg-ink/35 backdrop-blur-sm"
					/>
					<section
						role="dialog"
						aria-modal="true"
						aria-labelledby="share-dialog-title"
						className="relative w-full max-w-lg rounded border border-rule bg-paper p-5 shadow-2xl"
					>
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="font-mono text-[0.625rem] tracking-widest text-accent uppercase">
									Self-contained link
								</p>
								<h2
									id="share-dialog-title"
									className="mt-1 font-display text-2xl font-semibold text-ink"
								>
									Share this visualization
								</h2>
							</div>
							<button
								type="button"
								aria-label="Close"
								onClick={() => setShareOpen(false)}
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-paper-2"
							>
								<X size={18} />
							</button>
						</div>
						<p className="mt-3 text-sm leading-relaxed text-ink-3">
							SQL and schema DDL are compressed and encoded in the URL, not
							encrypted. Anyone with the link can recover them.
						</p>
						{ddlText.trim() ||
						new TextEncoder().encode(editorRef.current?.getValue() ?? sqlText)
							.byteLength > 20_000 ? (
							<p className="mt-2 rounded border border-rule bg-paper-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
								{ddlText.trim()
									? "This link includes schema DDL. Review it for sensitive identifiers before copying."
									: "This is an unusually large query. The resulting URL may not work in every messaging app."}
							</p>
						) : null}
						<div className="mt-5 grid gap-2 sm:grid-cols-2">
							<button
								type="button"
								data-testid="copy-share-link"
								onClick={() => copyShareValue("url")}
								className="flex items-center justify-center gap-2 rounded bg-ink px-4 py-2.5 font-mono text-xs text-paper"
							>
								{shareStatus === "copied" ? (
									<Check size={15} />
								) : (
									<Copy size={15} />
								)}
								{shareStatus === "copied" ? "Link copied" : "Copy link"}
							</button>
							<button
								type="button"
								data-testid="copy-markdown-link"
								onClick={() => copyShareValue("markdown")}
								className="flex items-center justify-center gap-2 rounded border border-rule px-4 py-2.5 font-mono text-xs text-ink-2 hover:bg-paper-2"
							>
								{shareStatus === "markdown" ? (
									<Check size={15} />
								) : (
									<Copy size={15} />
								)}
								{shareStatus === "markdown"
									? "Markdown copied"
									: "Copy Markdown link"}
							</button>
						</div>
						{shareError ? (
							<p
								role="alert"
								data-testid="share-error"
								className="mt-3 text-sm leading-relaxed text-accent"
							>
								{shareError}
							</p>
						) : null}
						{shareStatus === "ready" && shareUrl ? (
							<div className="mt-3">
								<output className="mb-2 block text-sm text-teal-2">
									Link ready to copy manually.
								</output>
								<label
									htmlFor="share-url-fallback"
									className="font-mono text-[0.625rem] tracking-wide text-ink-3 uppercase"
								>
									Clipboard unavailable — copy this link manually
								</label>
								<div className="mt-1 flex gap-2">
									<input
										id="share-url-fallback"
										data-testid="share-url-fallback"
										readOnly
										value={shareUrl}
										onFocus={(event) => event.currentTarget.select()}
										className="min-w-0 flex-1 rounded border border-rule bg-paper-2 px-3 py-2 font-mono text-xs text-ink"
									/>
									<button
										type="button"
										onClick={copyFallback}
										aria-label="Try copying again"
										className="rounded border border-rule px-3 text-ink-2"
									>
										<Copy size={15} />
									</button>
								</div>
							</div>
						) : null}
					</section>
				</div>
			) : null}
		</NodeActionsContext.Provider>
	);
}

export function QueryGraphApp({
	initialShareState,
	isShared = false,
}: {
	initialShareState?: RestorableShareState;
	isShared?: boolean;
}) {
	return (
		<ReactFlowProvider>
			<GraphStage initialShareState={initialShareState} isShared={isShared} />
		</ReactFlowProvider>
	);
}
