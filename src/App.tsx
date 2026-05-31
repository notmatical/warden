import { AppShell } from "@/components/app-shell"
import { Toaster } from "@/components/ui/sonner"

export function App() {
  return (
    <>
      <AppShell />
      <Toaster position="bottom-right" richColors />
    </>
  )
}

export default App
