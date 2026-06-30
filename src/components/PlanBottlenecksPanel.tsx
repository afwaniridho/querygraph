import { ArrowRight, Gauge, SearchX } from "lucide-react";
import type {
	PlanBottleneckItem,
	PlanBottleneckSection,
} from "#/lib/explain/bottlenecks";

export function PlanBottlenecksPanel({
	sections,
	selectedNodeId,
	onSelect,
}: {
	sections: PlanBottleneckSection[];
	selectedNodeId?: string;
	onSelect: (item: PlanBottleneckItem) => void;
}) {
	return (
		<section aria-label="Top bottlenecks" data-testid="plan-bottlenecks">
			<div className="px-4 pt-3 pb-2">
				<div className="flex items-center gap-2">
					<Gauge size={15} className="text-accent" />
					<h2 className="font-display text-sm font-semibold">
						Top bottlenecks
					</h2>
				</div>
				<div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[0.56rem] text-ink-4 uppercase">
					<span className="rounded-sm border border-rule px-1.5 py-0.5">
						Inclusive time, not exclusive root cause
					</span>
					<span className="rounded-sm border border-rule px-1.5 py-0.5">
						Do not sum parent/child times
					</span>
					<span className="rounded-sm border border-rule px-1.5 py-0.5">
						Estimated cost is not milliseconds
					</span>
				</div>
			</div>
			{sections.length ? (
				<div className="space-y-3 px-3 pb-3">
					{sections.map((section) => (
						<section key={section.kind} className="border-t border-rule pt-2">
							<div className="px-1">
								<h3 className="font-mono text-[0.62rem] tracking-wide text-ink-3 uppercase">
									{section.title}
								</h3>
								<p className="mt-0.5 text-[0.68rem] leading-snug text-ink-4">
									{section.description}
								</p>
							</div>
							<div className="mt-2 space-y-1.5">
								{section.items.map((item, index) => (
									<button
										type="button"
										key={`${section.kind}-${item.nodeId}`}
										onClick={() => onSelect(item)}
										data-on={selectedNodeId === item.nodeId}
										data-testid={`plan-bottleneck-${section.kind}`}
										className="group w-full rounded border border-rule px-2.5 py-2 text-left hover:border-ink-4 focus-visible:outline-2 focus-visible:outline-accent data-[on=true]:border-accent data-[on=true]:bg-paper-2"
									>
										<div className="flex items-start gap-2">
											<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-rule bg-paper-2 font-mono text-[0.58rem] text-ink-3">
												{index + 1}
											</span>
											<span className="min-w-0 flex-1">
												<span className="flex items-center justify-between gap-2">
													<strong className="truncate text-xs text-ink-2">
														{item.nodeType}
														{item.label ? ` · ${item.label}` : ""}
													</strong>
													<span className="shrink-0 font-mono text-[0.65rem] text-accent">
														{item.displayValue}
													</span>
												</span>
												<span className="mt-1 block text-[0.68rem] leading-snug text-ink-4">
													{item.evidence}
												</span>
											</span>
											<ArrowRight
												size={13}
												className="mt-1 shrink-0 text-ink-4 group-hover:text-accent"
											/>
										</div>
									</button>
								))}
							</div>
						</section>
					))}
				</div>
			) : (
				<div className="flex items-start gap-2 border-t border-rule px-4 py-5 text-xs text-ink-4">
					<SearchX size={15} className="mt-0.5 shrink-0" />
					<p>
						No useful bottleneck metrics found in this plan. Try PostgreSQL
						EXPLAIN ANALYZE with BUFFERS for runtime and I/O ranking.
					</p>
				</div>
			)}
		</section>
	);
}
