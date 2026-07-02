import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@/styles/globals.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ToastWindow } from "./toast-window.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastWindow />
    </ThemeProvider>
  </StrictMode>
)
