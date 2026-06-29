import { createFileRoute } from "@tanstack/react-router";
import { ExecutionPlanApp } from "#/components/ExecutionPlanApp";

export const Route = createFileRoute("/explain")({
	component: ExecutionPlanApp,
	head: () => ({
		meta: [
			{ title: "PostgreSQL EXPLAIN Visualizer — QueryGraph" },
			{
				name: "description",
				content:
					"Visualize PostgreSQL EXPLAIN JSON locally as an execution-plan tree.",
			},
		],
	}),
});
