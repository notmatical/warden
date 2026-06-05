import { ToolRow } from "@/components/settings/tool-row";
import { runInLoginTerminal, shellBin } from "@/lib/cli-login";
import { PROVIDER_ICON } from "@/lib/provider-icons";
import { useAppStore } from "@/store/app-store";
import type { ProviderStatus } from "@/types";

function signInProvider(status: ProviderStatus) {
	const bin = shellBin(status.path, status.id);
	const command = status.id === "codex" ? `${bin} login` : bin;
	void runInLoginTerminal(`Sign in: ${status.name}`, command);
}

export function ProvidersSection() {
	const providers = useAppStore((s) => s.providers);
	const installProvider = useAppStore((s) => s.installProvider);
	const updateProvider = useAppStore((s) => s.updateProvider);
	const setProviderSource = useAppStore((s) => s.setProviderSource);

	return (
		<div>
			<header className="border-b border-border/60 px-3.5 py-4">
				<h2 className="text-sm font-medium">Providers</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Agent CLIs that power your sessions. Run warden's managed copy or the
					one on your PATH.
				</p>
			</header>
			{providers.length === 0 ? (
				<p className="px-3.5 py-6 text-[11px] text-muted-foreground">
					No providers detected.
				</p>
			) : (
				<div className="divide-y divide-border/60">
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
		</div>
	);
}
