import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Tauri exposes the dev host for mobile/remote development.
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
	readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

// https://vite.dev/config/ — tuned for Tauri per
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},

	// Prevent Vite from clearing Rust compiler errors during `tauri dev`.
	clearScreen: false,
	// Tauri expects a fixed port and fails if it is not available.
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},

	// Only `VITE_`- and `TAURI_ENV_`-prefixed env vars reach the frontend.
	envPrefix: ["VITE_", "TAURI_ENV_"],
	build: {
		target:
			process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
		// Vite 8 bundles rolldown; let it use its native (oxc) minifier rather than
		// the now-separate esbuild. `false` in debug builds for readable output.
		minify: !process.env.TAURI_ENV_DEBUG,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
});
