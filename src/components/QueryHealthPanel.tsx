import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { HealthFinding, HealthSeverity } from "#/lib/query-health/types";

interface Props {
	findings: HealthFinding[];
	selected: HealthFinding | null;
	onSelect: (finding: HealthFinding) => void;
}

const severityMeta: Record<
	HealthSeverity,
	{ label: string; icon: typeof Info; color: string }
> = {
	danger: {
		label: "Danger",
		icon: ShieldAlert,
		color: "var(--color-accent-2)",
	},
	warning: {
		label: "Warning",
		icon: AlertTriangle,
		color: "var(--color-ochre)",
	},
	info: { label: "Info", icon: Info, color: "var(--color-teal)" },
};

export function QueryHealthPanel({ findings, selected, onSelect }: Props) {
	const counts = {
		danger: findings.filter((item) => item.severity === "danger").length,
		warning: findings.filter((item) => item.severity === "warning").length,
		info: findings.filter((item) => item.severity === "info").length,
	};

	return (
		<section
			className="flex max-h-[38dvh] min-h-[8.5rem] flex-col border-t border-rule bg-paper md:max-h-[42%] md:min-h-[9.5rem]"
			aria-label="Query Health"
			data-testid="query-health"
		>
			<header className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2.5 sm:gap-3 sm:px-4">
				<div className="min-w-0 flex-1">
					<h2 className="font-display text-sm font-semibold">Query Health</h2>
					<p className="font-mono text-[0.5625rem] text-ink-4">
						Static analysis · parses as you type · not EXPLAIN
					</p>
				</div>
				<div className="ml-auto flex shrink-0 gap-1.5">
					{(["danger", "warning", "info"] as const).map((severity) => (
						<span
							key={severity}
							className="rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[0.6rem]"
							style={{ color: severityMeta[severity].color }}
							title={severityMeta[severity].label}
						>
							{counts[severity]} {severity.slice(0, 1).toUpperCase()}
						</span>
					))}
				</div>
			</header>
			{findings.length === 0 ? (
				<div className="flex flex-1 items-center gap-2 px-4 py-4 text-sm text-ink-3">
					<CheckCircle2 size={17} className="text-moss" />
					<div>
						<p className="font-medium text-ink-2">
							No high-confidence issues found
						</p>
						<p className="mt-0.5 text-xs text-ink-4">
							This is not a guarantee of runtime performance or correctness.
						</p>
					</div>
				</div>
			) : (
				<div className="grid min-h-0 flex-1 md:grid-cols-[minmax(11rem,0.9fr)_minmax(14rem,1.2fr)]">
					<div className="max-h-[13dvh] overflow-y-auto border-b border-rule md:max-h-none md:border-r md:border-b-0">
						{findings.map((finding, index) => {
							const meta = severityMeta[finding.severity];
							const Icon = meta.icon;
							const active =
								selected?.ruleId === finding.ruleId &&
								selected?.nodeId === finding.nodeId;
							return (
								<button
									key={`${finding.ruleId}-${finding.nodeId ?? index}`}
									type="button"
									data-testid={`finding-${finding.ruleId}`}
									data-on={active}
									onClick={() => onSelect(finding)}
									className="flex w-full gap-2 border-b border-rule-soft px-3 py-2 text-left data-[on=true]:bg-paper-2"
								>
									<Icon
										size={14}
										className="mt-0.5 shrink-0"
										style={{ color: meta.color }}
									/>
									<span>
										<span className="block text-xs font-semibold text-ink-2">
											{finding.title}
										</span>
										<span className="mt-0.5 block font-mono text-[0.5625rem] text-ink-4">
											{finding.ruleId}
										</span>
									</span>
								</button>
							);
						})}
					</div>
					<div className="overflow-y-auto px-3 py-3 sm:px-4">
						{selected ? (
							<div className="space-y-2.5 text-xs leading-relaxed">
								<p className="font-semibold text-ink-2">{selected.evidence}</p>
								<div className="flex flex-wrap gap-1.5 font-mono text-[0.5625rem] tracking-wide uppercase">
									<span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-3">
										{selected.category}
									</span>
									<span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-3">
										{selected.confidence} confidence
									</span>
									<span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-3">
										{selected.evidenceKind.replace("-", " ")}
									</span>
								</div>
								<p className="text-ink-3">{selected.explanation}</p>
								<div className="rounded-sm border border-rule bg-paper-2 p-2.5">
									<p className="font-mono text-[0.5625rem] tracking-wide text-teal uppercase">
										Rewrite direction
									</p>
									<p className="mt-1 text-ink-2">{selected.remediation}</p>
								</div>
								{selected.requiresDdl && (
									<p className="font-mono text-[0.5625rem] text-ink-4">
										Uses the supplied DDL; actual planner behavior may differ.
									</p>
								)}
							</div>
						) : (
							<p className="text-xs text-ink-4">
								Select a finding to see its evidence and rewrite direction.
							</p>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
