import { Bot, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import * as ipc from "@/lib/ipc";
import { DEFAULT_CHAT_MODEL, DEFAULT_CODEX_MODEL } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Provider, ProviderStatus } from "@/types";

const ICONS: Record<Provider, typeof Bot> = {
	claude: Sparkles,
	codex: Bot,
};

// Shell command that drives each provider's interactive login.
const LOGIN_COMMAND: Record<Provider, string> = {
	claude: "claude",
	codex: "codex login",
};

function dotClass(status: ProviderStatus): string {
	if (!status.installed) return "bg-muted-foreground/40";
	return status.authed ? "bg-emerald-500" : "bg-amber-500";
}

function needsAttention(status: ProviderStatus): boolean {
	return !status.installed || !status.authed;
}

function ProviderRow({ status }: { status: ProviderStatus }) {
	const primaryRootId = useAppStore((s) =>
		s.activeGroupId ? (s.rootsByGroup[s.activeGroupId]?.[0]?.id ?? null) : null,
	);
	const createSession = useAppStore((s) => s.createSession);
	const installProvider = useAppStore((s) => s.installProvider);
	const updateProvider = useAppStore((s) => s.updateProvider);

	const Icon = ICONS[status.id];

	const signIn = async () => {
		if (!primaryRootId) return;
		const session = await createSession({
			projectId: primaryRootId,
			title: `Sign in — ${status.name}`,
			model: status.id === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CHAT_MODEL,
			permissionMode: "bypassPermissions",
			role: "chat",
			kind: "terminal",
		});
		if (!session) return;
		// The PTY spawns when the terminal pane mounts; give it a beat before
		// typing the login command into the fresh shell.
		setTimeout(() => {
			void ipc.terminalWrite(session.id, `${LOGIN_COMMAND[status.id]}\r`);
		}, 400);
	};

	const [busy, setBusy] = useState(false);
	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		try {
			await fn();
		} finally {
			setBusy(false);
		}
	};

	let action: { label: string; onClick: () => void };
	if (!status.installed) {
		action = {
			label: "Install",
			onClick: () => void run(() => installProvider(status.id)),
		};
	} else if (!status.authed) {
		action = { label: "Sign in", onClick: () => void signIn() };
	} else {
		action = {
			label: "Update",
			onClick: () => void run(() => updateProvider(status.id)),
		};
	}

	return (
		<div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
			<Icon className="size-4 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<span
					className={cn("size-1.5 shrink-0 rounded-full", dotClass(status))}
				/>
				<span className="truncate text-sm">{status.name}</span>
				{status.version && (
					<span className="truncate text-xs text-muted-foreground">
						{status.version}
					</span>
				)}
			</div>
			<Button
				variant={action.label === "Update" ? "ghost" : "secondary"}
				size="xs"
				onClick={action.onClick}
				disabled={busy || (action.label === "Sign in" && !primaryRootId)}
				className="shrink-0"
			>
				{busy ? <Loader2 className="size-3 animate-spin" /> : action.label}
			</Button>
		</div>
	);
}

export function ProvidersPopover() {
	const providers = useAppStore((s) => s.providers);

	if (providers.length === 0) {
		return null;
	}

	const attention = providers.some(needsAttention);

	return (
		<HoverCard openDelay={120} closeDelay={120}>
			<HoverCardTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Providers"
					title="Providers"
					className="shrink-0 text-muted-foreground hover:text-foreground"
				>
					<span className="relative inline-flex">
						<Bot className="size-4" />
						<span
							className={cn(
								"absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
								attention ? "bg-amber-500" : "bg-emerald-500",
							)}
						/>
					</span>
				</Button>
			</HoverCardTrigger>
			<HoverCardContent
				align="end"
				sideOffset={8}
				className="w-72 rounded-xl p-1.5"
			>
				<div className="flex flex-col gap-0.5">
					{providers.map((status) => (
						<ProviderRow key={status.id} status={status} />
					))}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
