import { createContext } from "react";

export interface NodeActions {
	openDetails: (nodeId: string) => void;
}

export const NodeActionsContext = createContext<NodeActions>({
	openDetails: () => {},
});
