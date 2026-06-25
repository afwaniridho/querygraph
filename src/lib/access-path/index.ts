import { buildMysqlFacts } from "#/lib/access-path/facts-mysql";
import { buildPostgresFacts } from "#/lib/access-path/facts-postgres";
import type { BlockFacts } from "#/lib/access-path/types";
import type { Dialect } from "#/lib/dialect";

export { analyzeTableAccess } from "#/lib/access-path/analyze";
export type {
	AccessMethod,
	AccessPathInfo,
	BlockFacts,
} from "#/lib/access-path/types";

export function buildFacts(ast: unknown, dialect: Dialect): BlockFacts {
	return dialect === "postgres"
		? buildPostgresFacts(ast as never)
		: buildMysqlFacts(ast as never);
}
