import { listen } from "@tauri-apps/api/event";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { PROVIDER_ICON } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { ProviderStatus } from "@/types";

interface InstallProgress {
	tool: string;
	stage: string;
	message: string;
	percent: number;
}

/** One provider needing attention — install when missing, update when behind —
 *  with live install progress. */
function UpdateRow({ status }: { status: ProviderStatus }) {
	const installProvider = useAppStore((s) => s.installProvider);
	const updateProvider = useAppStore((s) => s.updateProvider);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<InstallProgress | null>(null);

	useEffect(() => {
		const unlisten = listen<InstallProgress>("cli:install-progress", (e) => {
			if (e.payload.tool === status.id) setProgress(e.payload);
		});
		return () => void unlisten.then((off) => off());
	}, [status.id]);

	const Icon = PROVIDER_ICON[status.id];
	const needsInstall = !status.installed;
	const current = status.managedVersion ?? status.version;

	const run = async () => {
		setBusy(true);
		try {
			await (needsInstall
				? installProvider(status.id)
				: updateProvider(status.id));
		} finally {
			setBusy(false);
			setProgress(null);
		}
	};

	return (
		<div className="flex flex-col gap-2 px-3 py-2.5">
			<div className="flex items-center gap-2.5">
				<Icon className="size-4 shrink-0" />
				<div className="flex min-w-0 flex-1 flex-col leading-tight">
					<span className="truncate text-[13px] font-medium text-foreground">
						{status.name}
					</span>
					<span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
						{needsInstall
							? "Not installed"
							: `${current ?? "?"} → ${status.latestVersion ?? "latest"}`}
					</span>
				</div>
				{!progress ? (
					<Button
						size="xs"
						onClick={() => void run()}
						disabled={busy}
						className="h-6 shrink-0 bg-foreground px-2.5 text-background hover:bg-foreground/90"
					>
						{busy ? (
							<Loader2 className="size-3 animate-spin" />
						) : needsInstall ? (
							"Install"
						) : (
							"Update"
						)}
					</Button>
				) : null}
			</div>
			{progress ? (
				<div className="flex flex-col gap-1">
					<div className="h-1 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-foreground/80 transition-[width] duration-300"
							style={{ width: `${progress.percent}%` }}
						/>
					</div>
					<span className="truncate font-mono text-[10px] text-muted-foreground">
						{progress.message}
					</span>
				</div>
			) : null}
		</div>
	);
}

/** Header control: a download icon that appears only when an agent CLI needs
 *  installing or updating, with a count badge and a popover to act on each. */
export function CliUpdates() {
	const providers = useAppStore((s) => s.providers);
	const [open, setOpen] = useState(false);

	const pending = useMemo(
		() => providers.filter((p) => !p.installed || p.updateAvailable),
		[providers],
	);

	if (pending.length === 0) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="CLI updates"
							className="relative text-muted-foreground hover:text-foreground"
						>
							<Download />
							<span
								className={cn(
									"absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center",
									"rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground tabular-nums",
								)}
							>
								{pending.length}
							</span>
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>
					{pending.length} CLI {pending.length === 1 ? "update" : "updates"}
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
					<span className="text-sm font-medium text-foreground">Agent CLIs</span>
					<span className="text-[11px] text-muted-foreground tabular-nums">
						{pending.length} pending
					</span>
				</div>
				<div className="divide-y divide-border/50">
					{pending.map((status) => (
						<UpdateRow key={status.id} status={status} />
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
