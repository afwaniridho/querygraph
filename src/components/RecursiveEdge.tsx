import { BaseEdge, type EdgeProps } from "@xyflow/react";

export function RecursiveEdge({ data, style, markerEnd }: EdgeProps) {
	const fromX = (data?.fromX as number) ?? 0;
	const fromY = (data?.fromY as number) ?? 0;
	const toX = (data?.toX as number) ?? 0;
	const toY = (data?.toY as number) ?? 0;
	const loopX = (data?.loopX as number) ?? Math.max(fromX, toX) + 100;

	const path = `M ${fromX},${fromY} C ${loopX},${fromY} ${loopX},${toY} ${toX},${toY}`;

	return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
