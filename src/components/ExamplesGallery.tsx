import { BookOpen, X } from "lucide-react";
import { SQL_EXAMPLES, type SqlExample } from "#/lib/examples";

interface Props {
	onClose: () => void;
	onSelect: (example: SqlExample) => void;
}

export function ExamplesGallery({ onClose, onSelect }: Props) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 p-0 backdrop-blur-[2px] md:items-center md:p-6"
			role="dialog"
			aria-modal="true"
			aria-labelledby="examples-title"
			data-testid="examples-gallery"
		>
			<div className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-t-lg border border-rule bg-paper shadow-2xl md:max-h-[88dvh] md:rounded-lg">
				<header className="flex items-start gap-3 border-b border-rule px-4 py-3 sm:px-5 sm:py-4">
					<BookOpen className="mt-0.5 shrink-0 text-accent" size={19} />
					<div className="min-w-0 flex-1">
						<h2
							id="examples-title"
							className="font-display text-lg font-semibold sm:text-xl"
						>
							SQL Example Gallery
						</h2>
						<p className="mt-1 text-xs leading-relaxed text-ink-3 sm:text-sm">
							Choose a clinic case to replace the current SQL, dialect, and
							optional schema.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close examples"
						className="ml-auto rounded p-2 text-ink-3 hover:bg-paper-2"
					>
						<X size={18} />
					</button>
				</header>
				<div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2 sm:gap-3 sm:p-4 lg:grid-cols-3">
					{SQL_EXAMPLES.map((example) => (
						<button
							key={example.id}
							type="button"
							data-testid={`example-${example.id}`}
							onClick={() => onSelect(example)}
							className="group rounded border border-rule bg-paper p-3 text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md sm:p-4"
						>
							<div className="flex items-center justify-between gap-2 font-mono text-[0.6rem] tracking-wide uppercase">
								<span className="text-accent">{example.category}</span>
								<span className="text-ink-4">{example.dialect}</span>
							</div>
							<h3 className="mt-2 font-display text-sm font-semibold text-ink group-hover:text-accent-2 sm:text-base">
								{example.title}
							</h3>
							<p className="mt-1.5 text-xs leading-snug text-ink-3 sm:text-sm">
								{example.objective}
							</p>
							<p className="mt-3 font-mono text-[0.625rem] text-ink-4">
								{example.difficulty}
								{example.expectedFindingIds.length
									? ` · ${example.expectedFindingIds.length} expected finding${example.expectedFindingIds.length === 1 ? "" : "s"}`
									: " · guided exploration"}
							</p>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
