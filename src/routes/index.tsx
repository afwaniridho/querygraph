import { createFileRoute } from "@tanstack/react-router";
import { QueryGraphShell } from "#/components/QueryGraphShell";

export const Route = createFileRoute("/")({ component: QueryGraphShell });
