import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProviderSource, ProviderStatus } from "@/types";

const SOURCES: { value: ProviderSource; label: string }[] = [
	{ value: "auto", label: "Auto" },
	{ value: "managed", label: "Managed" },
	{ value: "system", label: "System" },
];

interface InstallProgress {
	tool: string;
	stage: string;
	message: string;
	percent: number;
}

interface ToolRowProps {
	status: ProviderStatus;
	icon: ComponentType<{ className?: string }>;
	onInstall: () => Promise<void>;
	onUpdate: () => Promise<void>;
	onSetSource: (source: ProviderSource) => void;
	/** When present and the tool is unauthenticated, a "Sign in" action shows. */
	onSignIn?: () => void;
}

/** The connection-state line: muted when fine, accented only when action is due. */
function connectionState(status: ProviderStatus): { label: string; tone: string } {
	if (!status.installed)
		return { label: "Not installed", tone: "text-muted-foreground" };
	if (!status.authed)
		return { label: "Not signed in", tone: "text-amber-600 dark:text-amber-500" };
	return { label: "Connected", tone: "text-muted-foreground" };
}

/** One managed CLI: brand mark, version, connection state, a source toggle, and
 *  an Install / Sign in / Update action with live install progress. */
export function ToolRow({
	status,
	icon: Icon,
	onInstall,
	onUpdate,
	onSetSource,
	onSignIn,
}: ToolRowProps) {
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<InstallProgress | null>(null);

	useEffect(() => {
		const unlisten = listen<InstallProgress>("cli:install-progress", (e) => {
			if (e.payload.tool === status.id) setProgress(e.payload);
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

	let action: { label: string; primary: boolean; onClick: () => void } | null =
		null;
	if (!status.installed) {
		action = { label: "Install", primary: true, onClick: () => void run(onInstall) };
	} else if (!status.authed && onSignIn) {
		action = { label: "Sign in", primary: true, onClick: onSignIn };
	} else if (status.updateAvailable) {
		action = { label: "Update", primary: false, onClick: () => void run(onUpdate) };
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
						disabled={busy}
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
								onClick={() => onSetSource(opt.value)}
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
