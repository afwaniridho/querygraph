import { lazy, Suspense, useEffect, useState } from "react";
import type { RestorableShareState } from "#/lib/share-url";

const QueryGraphApp = lazy(() =>
	import("#/components/QueryGraphApp").then((module) => ({
		default: module.QueryGraphApp,
	})),
);

export function QueryGraphShell({
	initialShareState,
	isShared = false,
}: {
	initialShareState?: RestorableShareState;
	isShared?: boolean;
}) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="flex h-dvh w-full flex-col items-center justify-center gap-5 bg-paper">
				<span className="font-display text-xl font-semibold tracking-tight text-ink">
					QueryGraph
				</span>
				<div className="h-px w-24 overflow-hidden bg-rule">
					<div
						className="h-full w-2/5"
						style={{
							background: "var(--color-accent)",
							animation: "qg-rise 1s ease-in-out infinite alternate",
						}}
					/>
				</div>
			</div>
		);
	}

	return (
		<Suspense fallback={<div className="h-dvh w-full bg-paper" />}>
			<QueryGraphApp
				initialShareState={initialShareState}
				isShared={isShared}
			/>
		</Suspense>
	);
}
