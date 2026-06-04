import { useEffect } from "react";

import { GitHubIcon } from "@/components/icons/brand";
import { ToolRow } from "@/components/settings/tool-row";
import { runInLoginTerminal, shellBin } from "@/lib/cli-login";
import { useAppStore } from "@/store/app-store";

export function IntegrationsSection() {
	const status = useAppStore((s) => s.githubStatus);
	const loadGithubStatus = useAppStore((s) => s.loadGithubStatus);
	const installGithub = useAppStore((s) => s.installGithub);
	const updateGithub = useAppStore((s) => s.updateGithub);
	const setGithubSource = useAppStore((s) => s.setGithubSource);

	useEffect(() => {
		void loadGithubStatus();
	}, [loadGithubStatus]);

	return (
		<div>
			<header className="border-b border-border/60 px-3.5 py-4">
				<h2 className="text-sm font-medium">Integrations</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">
					The GitHub CLI lets warden read issues and open pull requests on your
					behalf.
				</p>
			</header>
			{status ? (
				<div className="divide-y divide-border/60">
					<ToolRow
						status={status}
						icon={GitHubIcon}
						onInstall={installGithub}
						onUpdate={updateGithub}
						onSetSource={setGithubSource}
						onSignIn={() =>
							void runInLoginTerminal(
								"Sign in: GitHub CLI",
								`${shellBin(status.path, "gh")} auth login`,
							)
						}
					/>
				</div>
			) : (
				<p className="px-3.5 py-6 text-[11px] text-muted-foreground">
					Checking GitHub CLI…
				</p>
			)}
		</div>
	);
}
