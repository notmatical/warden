import { AppShell } from "@/components/app-shell"
import { KeybindingProvider } from "@/components/keybinding-provider"
import { Toaster } from "@/components/ui/sonner"

export function App() {
  return (
    <KeybindingProvider>
      <AppShell />
      <Toaster position="bottom-right" richColors />
    </KeybindingProvider>
  )
}

export default App
