import { X } from "lucide-react";
import { useEffect } from "react";

interface Props {
	closing: boolean;
	onClose: () => void;
}

export function AboutModal({ closing, onClose }: Props) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close dialog"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-ink/35 backdrop-blur-sm"
				style={{
					animation: `${closing ? "qg-fade-out 0.18s" : "qg-fade-in 0.2s"} ease forwards`,
				}}
			/>
			<div
				className="relative w-full max-w-lg border border-rule bg-paper shadow-2xl"
				style={{
					borderRadius: 4,
					animation: `${closing ? "qg-pop-out 0.15s" : "qg-pop-in 0.28s"} ease forwards`,
				}}
				role="dialog"
				aria-modal="true"
				aria-label="About QueryGraph"
			>
				<header className="flex items-center justify-between border-b border-rule px-6 py-4">
					<h2 className="font-display text-2xl font-semibold text-ink">
						QueryGraph
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex h-9 w-9 items-center justify-center rounded text-ink-3 transition hover:bg-paper-2 hover:text-ink"
					>
						<X size={20} />
					</button>
				</header>

				<div className="space-y-4 px-6 py-5 text-[0.9375rem] leading-relaxed text-ink-2">
					<p>
						QueryGraph reads a PostgreSQL or MySQL statement and draws it back
						to you as a step-by-step diagram — every clause becomes a numbered
						card, wired in a simplified logical SQL-processing order. It is not
						a database execution plan.
					</p>
					<p>
						Paste a query or open a clinic example, then use Query Health to
						review evidence-based static findings. Nothing connects to a
						database; parsing and analysis happen in your browser. If you
						explicitly create a share link, its URL contains the compressed SQL
						and optional DDL so the recipient can reconstruct it.
					</p>
					<p>
						It is built for anyone who inherited a 40-line query and needs to
						know what it does before trusting it: full-stack engineers, data
						teams, and reviewers untangling production SQL.
					</p>
				</div>
			</div>
		</div>
	);
}
