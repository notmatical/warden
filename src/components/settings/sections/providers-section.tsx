import { SettingsSection } from "@/components/settings/settings-section"
import { ToolRow } from "@/components/settings/tool-row"
import { runInLoginTerminal, shellBin } from "@/lib/cli-login"
import { PROVIDER_ICON } from "@/lib/provider-icons"
import { useAppStore } from "@/store/app-store"
import type { ProviderStatus } from "@/types"

function signInProvider(status: ProviderStatus) {
  const bin = shellBin(status.path, status.id)
  const command = status.id === "codex" ? `${bin} login` : bin
  void runInLoginTerminal(`Sign in: ${status.name}`, command)
}

export function ProvidersSection() {
  const providers = useAppStore((s) => s.providers)
  const installProvider = useAppStore((s) => s.installProvider)
  const updateProvider = useAppStore((s) => s.updateProvider)
  const setProviderSource = useAppStore((s) => s.setProviderSource)

  return (
    <SettingsSection
      title="Providers"
      description="Agent CLIs that power your sessions. Run warden's managed copy or the one on your PATH."
    >
      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No providers detected.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/60 divide-y divide-border/60">
          {providers.map((status) => (
            <ToolRow
              key={status.id}
              status={status}
              icon={PROVIDER_ICON[status.id]}
              onInstall={() => installProvider(status.id)}
              onUpdate={() => updateProvider(status.id)}
              onSetSource={(source) => setProviderSource(status.id, source)}
              onSignIn={() => signInProvider(status)}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}
