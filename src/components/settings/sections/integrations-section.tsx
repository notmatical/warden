import { useEffect } from "react"

import { GitHubIcon } from "@/components/icons/brand"
import { SettingsSection } from "@/components/settings/settings-section"
import { ToolList, ToolRow } from "@/components/settings/tool-list"
import { LinearIntegrationRow } from "@/integrations/linear/components/linear-integration-row"
import { runInLoginTerminal, shellBin } from "@/lib/cli-login"
import { useAppStore } from "@/store/app-store"

export function IntegrationsSection() {
  const status = useAppStore((s) => s.githubStatus)
  const loadGithubStatus = useAppStore((s) => s.loadGithubStatus)
  const installGithub = useAppStore((s) => s.installGithub)
  const updateGithub = useAppStore((s) => s.updateGithub)
  const setGithubSource = useAppStore((s) => s.setGithubSource)

  useEffect(() => {
    void loadGithubStatus()
  }, [loadGithubStatus])

  return (
    <SettingsSection
      title="Integrations"
      description="Services warden can read and act on for you."
    >
      <ToolList>
        {status ? (
          <ToolRow
            status={status}
            icon={GitHubIcon}
            description="Open issues, pull requests, and reviews from your sessions."
            onInstall={installGithub}
            onUpdate={updateGithub}
            onSetSource={setGithubSource}
            onSignIn={() =>
              void runInLoginTerminal(
                "Sign in: GitHub CLI",
                `${shellBin(status.path, "gh")} auth login`
              )
            }
          />
        ) : null}
        <LinearIntegrationRow />
      </ToolList>
    </SettingsSection>
  )
}
