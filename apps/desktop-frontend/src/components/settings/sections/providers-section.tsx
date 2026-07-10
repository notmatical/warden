import { SettingsSection } from "@/components/settings/settings-section"
import { ToolCard } from "@/components/settings/tool-card"
import { runInLoginTerminal, shellBin } from "@/lib/cli-login"
import { PROVIDER_ICON } from "@/lib/provider-icons"
import { useAppStore } from "@/store/app-store"
import type { Provider, ProviderStatus } from "@/types"

const PROVIDER_DESCRIPTION: Record<Provider, string> = {
  claude: "Runs your Claude model sessions.",
  codex: "Runs your GPT model sessions.",
  opencode: "Runs open and third-party models through OpenCode.",
  cursor: "Runs your Cursor Agent model sessions.",
  grok: "Runs your Grok model sessions.",
}

/** The interactive command that signs each provider in. */
const SIGN_IN_ARGS: Record<Provider, string> = {
  claude: "",
  codex: " login",
  opencode: " auth login",
  cursor: " login",
  grok: " login --device-auth",
}

function signInProvider(status: ProviderStatus) {
  const bin = shellBin(status.path, status.id)
  const command = `${bin}${SIGN_IN_ARGS[status.id] ?? ""}`
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
      description="The agent CLIs that power your sessions."
    >
      {providers.length === 0 ? (
        <p className="text-muted-foreground text-xs">No providers detected.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {providers.map((status) => (
            <ToolCard
              key={status.id}
              status={status}
              icon={PROVIDER_ICON[status.id]}
              description={PROVIDER_DESCRIPTION[status.id]}
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
