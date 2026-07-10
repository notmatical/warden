import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import PierreDiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@/styles/globals.css"
import { ErrorBoundary } from "@/components/error-boundary.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { startModelCatalogSync } from "@/lib/model-catalog"
import { queryClient } from "@/lib/query"
import App from "./App.tsx"

// Revalidate the model catalog in the background (cache/bundled serve reads
// until then), then hourly.
startModelCatalogSync()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* Off-thread tokenization/highlighting for the diff viewer. */}
          <WorkerPoolContextProvider
            poolOptions={{
              workerFactory: () => new PierreDiffsWorker(),
              poolSize: 4,
            }}
            highlighterOptions={{ preferredHighlighter: "shiki-wasm" }}
          >
            <App />
          </WorkerPoolContextProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
