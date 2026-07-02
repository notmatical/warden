import { AppShell } from "@/components/app-shell"
import { CommandPalette } from "@/components/command-palette"
import { ConfirmProvider } from "@/components/confirm-dialog"
import { KeybindingProvider } from "@/components/keybinding-provider"
import { Toaster } from "@/components/ui/sonner"

export function App() {
  return (
    <KeybindingProvider>
      <ConfirmProvider>
        <AppShell />
      </ConfirmProvider>
      <CommandPalette />
      <Toaster position="bottom-right" richColors />
    </KeybindingProvider>
  )
}

export default App
