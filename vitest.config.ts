import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Standalone Vitest config: the app's vite.config.ts loads the Cloudflare
// plugin, which is incompatible with the Vitest runner. The lib tests are pure
// (no DOM), so a minimal node environment with the `#/*` alias is enough.
export default defineConfig({
	resolve: {
		alias: {
			"#": resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
