import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30000,
	retries: 0,
	use: {
		baseURL: "http://localhost:3456",
		headless: true,
		viewport: { width: 1280, height: 720 },
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
	webServer: {
		command: "pnpm dev --port 3456",
		url: "http://localhost:3456",
		reuseExistingServer: true,
		timeout: 60000,
	},
});
