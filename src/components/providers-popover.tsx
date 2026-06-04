import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AnthropicIcon, OpenAIIcon } from "@/components/icons/brand";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import * as ipc from "@/lib/ipc";
import { DEFAULT_CHAT_MODEL, DEFAULT_CODEX_MODEL } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Provider, ProviderSource, ProviderStatus } from "@/types";

const ICONS: Record<Provider, typeof AnthropicIcon> = {
	claude: AnthropicIcon,
	codex: OpenAIIcon,
};

const SOURCES: { value: ProviderSource; label: string }[] = [
	{ value: "auto", label: "Auto" },
	{ value: "managed", label: "Managed" },
	{ value: "system", label: "System" },
];

interface InstallProgress {
	provider: string;
	stage: string;
	message: string;
	percent: number;
}

function needsAttention(status: ProviderStatus): boolean {
	return !status.installed || !status.authed;
}

/** The connection state line: muted when fine, accented only when action is due. */
function connectionState(status: ProviderStatus): { label: string; tone: string } {
	if (!status.installed)
		return { label: "Not installed", tone: "text-muted-foreground" };
	if (!status.authed)
		return { label: "Not signed in", tone: "text-amber-600 dark:text-amber-500" };
	return { label: "Connected", tone: "text-muted-foreground" };
}

function ProviderRow({ status }: { status: ProviderStatus }) {
	const primaryRootId = useAppStore((s) =>
		s.activeGroupId ? (s.rootsByGroup[s.activeGroupId]?.[0]?.id ?? null) : null,
	);
	const createSession = useAppStore((s) => s.createSession);
	const installProvider = useAppStore((s) => s.installProvider);
	const updateProvider = useAppStore((s) => s.updateProvider);
	const setProviderSource = useAppStore((s) => s.setProviderSource);

	const Icon = ICONS[status.id];
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<InstallProgress | null>(null);

	// Mirror the backend's install-progress events for this provider.
	useEffect(() => {
		const unlisten = listen<InstallProgress>("cli:install-progress", (e) => {
			if (e.payload.provider === status.id) setProgress(e.payload);
		});
		return () => void unlisten.then((off) => off());
	}, [status.id]);

	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		try {
			await fn();
		} finally {
			setBusy(false);
			setProgress(null);
		}
	};

	const signIn = async () => {
		if (!primaryRootId) return;
		const session = await createSession({
			projectId: primaryRootId,
			title: `Sign in: ${status.name}`,
			model: status.id === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CHAT_MODEL,
			permissionMode: "bypassPermissions",
			role: "chat",
			kind: "terminal",
		});
		if (!session) return;
		// Run the resolved binary (managed or system), not a bare PATH name.
		const bin = status.path ? `"${status.path}"` : status.id;
		const loginCmd = status.id === "codex" ? `${bin} login` : bin;
		setTimeout(() => {
			void ipc.terminalWrite(session.id, `${loginCmd}\r`);
		}, 400);
	};

	let action: { label: string; primary: boolean; onClick: () => void } | null =
		null;
	if (!status.installed) {
		action = {
			label: "Install",
			primary: true,
			onClick: () => void run(() => installProvider(status.id)),
		};
	} else if (!status.authed) {
		action = { label: "Sign in", primary: true, onClick: () => void signIn() };
	} else if (status.updateAvailable) {
		action = {
			label: "Update",
			primary: false,
			onClick: () => void run(() => updateProvider(status.id)),
		};
	}

	const state = connectionState(status);

	return (
		<div className="flex flex-col gap-2.5 px-3.5 py-3">
			<div className="flex items-center gap-2.5">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40 text-foreground">
					<Icon className="size-4" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-baseline gap-2">
						<span className="truncate text-sm font-medium">{status.name}</span>
						{status.version && (
							<span className="truncate font-mono text-[10.5px] text-muted-foreground">
								{status.version}
							</span>
						)}
					</div>
					<span className={cn("text-[11px]", state.tone)}>{state.label}</span>
				</div>
				{action && !progress && (
					<Button
						variant="ghost"
						size="xs"
						onClick={action.onClick}
						disabled={busy || (action.label === "Sign in" && !primaryRootId)}
						className={cn(
							"shrink-0",
							action.primary
								? "bg-foreground text-background hover:bg-foreground/90"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{busy ? <Loader2 className="size-3 animate-spin" /> : action.label}
					</Button>
				)}
			</div>

			{progress ? (
				<div className="flex flex-col gap-1">
					<div className="h-0.5 overflow-hidden rounded-full bg-border">
						<div
							className="h-full bg-foreground/80 transition-[width] duration-300"
							style={{ width: `${progress.percent}%` }}
						/>
					</div>
					<span className="truncate font-mono text-[10px] text-muted-foreground">
						{progress.message}
					</span>
				</div>
			) : (
				<div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/70 bg-muted/30 p-0.5">
					{SOURCES.map((opt) => {
						const active = status.source === opt.value;
						const unavailable =
							(opt.value === "system" && !status.systemDetected) ||
							(opt.value === "managed" && !status.managedInstalled);
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => void setProviderSource(status.id, opt.value)}
								title={
									unavailable
										? opt.value === "system"
											? "Not found on PATH"
											: "Not installed"
										: undefined
								}
								className={cn(
									"rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors",
									active
										? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

/** The provider list, container-free so it drops into the popover today and a
 *  global settings pane later. */
export function ProvidersPanel() {
	const providers = useAppStore((s) => s.providers);

	if (providers.length === 0) {
		return (
			<p className="px-3.5 py-4 text-[11px] text-muted-foreground">
				No providers detected.
			</p>
		);
	}

	return (
		<div>
			<div className="px-3.5 pt-3 pb-2.5">
				<p className="text-sm font-medium">Providers</p>
				<p className="text-[11px] text-muted-foreground">
					Agent CLIs that power your sessions
				</p>
			</div>
			<div className="divide-y divide-border/60 border-t border-border/60">
				{providers.map((status) => (
					<ProviderRow key={status.id} status={status} />
				))}
			</div>
		</div>
	);
}

/** Short, semantic connection summary — no decorative dots, the label carries it. */
function connectionLabel(providers: ProviderStatus[]): string {
	if (providers.every((p) => p.installed && p.authed)) return "Connected";
	if (providers.some((p) => !p.installed)) return "Setup needed";
	return "Sign in needed";
}

/** Sidebar-footer status: a stacked cluster of provider brand marks plus a
 *  connection label, opening the provider management panel on click. */
export function ProvidersStatus() {
	const providers = useAppStore((s) => s.providers);

	if (providers.length === 0) {
		return null;
	}

	const attention = providers.some(needsAttention);

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label="Providers"
					className="group/providers flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
				>
					<span className="flex items-center">
						{providers.map((status, i) => {
							const Icon = ICONS[status.id];
							return (
								<span
									key={status.id}
									style={{ zIndex: providers.length - i }}
									className={cn(
										"flex size-6 items-center justify-center rounded-full bg-muted text-foreground ring-2 ring-sidebar transition-[margin]",
										i > 0 && "-ml-2 group-hover/providers:-ml-1",
									)}
								>
									<Icon className="size-3.5" />
								</span>
							);
						})}
					</span>
					<span className="flex min-w-0 flex-1 flex-col leading-tight">
						<span className="truncate text-xs font-medium">Providers</span>
						<span
							className={cn(
								"truncate text-[11px]",
								attention
									? "text-amber-600 dark:text-amber-400"
									: "text-muted-foreground",
							)}
						>
							{connectionLabel(providers)}
						</span>
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="right"
				align="end"
				sideOffset={12}
				className="w-80 p-0"
			>
				<ProvidersPanel />
			</PopoverContent>
		</Popover>
	);
}
