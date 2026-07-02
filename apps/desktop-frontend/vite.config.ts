import { readFileSync } from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const host = process.env.TAURI_DEV_HOST

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
) as { version: string }

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

  // Don't clear rust compiler errors in `tauri dev`
  clearScreen: false,
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
      ignored: ["**/src-tauri/**", "**/.warden/**", "**/.claude/**"],
    },
  },

  // Only `VITE_`- and `TAURI_ENV_`-prefixed env vars reach the frontend.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        notification: path.resolve(__dirname, "notification.html"),
      },
    },
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
