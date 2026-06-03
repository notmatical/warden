import { Check, ChevronsUpDown, Lock } from "lucide-react";
import { useMemo, useState } from "react";

import { AnimatedZap } from "@/components/animated-zap";
import { Shortcut } from "@/components/shortcut";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useControllableOpen } from "@/hooks/use-controllable-open";
import {
	backendForModel,
	baseModelId,
	formatModelName,
	isFastModel,
	MODEL_PROVIDERS,
	MODELS,
	supportsFast,
	withFast,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Backend } from "@/types";

interface ModelMenuProps {
	value: string;
	onChange: (model: string) => void;
	/** Backend the session currently runs on; locks the provider once started. */
	backend: Backend;
	/** Whether the session has taken a turn — after which the backend is fixed. */
	started: boolean;
	disabled?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/** Each provider rail entry, derived from {@link MODELS}. */
interface ProviderEntry {
	name: string;
	backend: Backend;
}

const PROVIDER_ENTRIES: ProviderEntry[] = MODEL_PROVIDERS.map((name) => ({
	name,
	backend: backendForModel(MODELS.find((m) => m.provider === name)!.id),
}));

export function ModelMenu({
	value,
	onChange,
	backend,
	started,
	disabled,
	open: controlledOpen,
	onOpenChange,
}: ModelMenuProps) {
	const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange);
	const providers = useAppStore((s) => s.providers);
	const base = baseModelId(value);
	const fast = isFastModel(value);
	const canFast = supportsFast(base);

	const activeProvider =
		MODELS.find((m) => m.id === base)?.provider ?? PROVIDER_ENTRIES[0].name;
	const [pane, setPane] = useState(activeProvider);
	// Snap the right pane back to the active model's provider each open.
	const [seenOpen, setSeenOpen] = useState(open);
	if (open !== seenOpen) {
		setSeenOpen(open);
		if (open) setPane(activeProvider);
	}

	const statusFor = useMemo(
		() => (b: Backend) => providers.find((p) => p.id === b) ?? null,
		[providers],
	);

	const paneModels = MODELS.filter((m) => m.provider === pane);
	const paneEntry =
		PROVIDER_ENTRIES.find((p) => p.name === pane) ?? PROVIDER_ENTRIES[0];
	// Before the first turn the session is provider-agnostic; once started, only
	// the current backend's models remain selectable.
	const paneLocked = started && paneEntry.backend !== backend;

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
						>
							{formatModelName(value)}
							{fast && <AnimatedZap active className="size-3" />}
							<ChevronsUpDown className="size-3 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top" className="flex items-center gap-1.5">
					Model
					<Shortcut combo={{ key: "e", mod: true }} />
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="w-[22rem] p-0">
				<div className="flex">
					{/* Provider rail */}
					<div className="w-32 shrink-0 border-r border-border/50 p-1">
						{PROVIDER_ENTRIES.map((entry) => {
							const status = statusFor(entry.backend);
							const locked = started && entry.backend !== backend;
							const selected = entry.name === pane;
							const dot = !status?.installed
								? "bg-muted-foreground/40"
								: status.authed
									? "bg-emerald-500"
									: "bg-amber-500";
							return (
								<button
									key={entry.name}
									type="button"
									disabled={locked}
									onClick={() => setPane(entry.name)}
									className={cn(
										"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden transition-colors",
										selected
											? "bg-accent text-accent-foreground"
											: "text-foreground/80 hover:bg-accent/50",
										locked && "pointer-events-none opacity-50",
									)}
								>
									<span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
									<span className="min-w-0 flex-1 truncate">{entry.name}</span>
									{locked && (
										<Lock className="size-3 shrink-0 text-muted-foreground" />
									)}
								</button>
							);
						})}
					</div>

					{/* Models for the selected provider */}
					<div className="min-w-0 flex-1 p-1">
						{paneLocked ? (
							<p className="px-2 py-3 text-xs text-muted-foreground">
								This session runs on{" "}
								{paneEntry.backend === "codex" ? "Codex" : "Claude"}. Its
								provider is fixed once it has started.
							</p>
						) : (
							paneModels.map((model) => {
								const selected = model.id === base;
								return (
									<button
										key={model.id}
										type="button"
										onClick={() => onChange(withFast(model.id, fast))}
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
									>
										<Check
											className={cn(
												"size-4 shrink-0",
												selected ? "opacity-100" : "opacity-0",
											)}
										/>
										<span className="min-w-0 flex-1 truncate">
											{model.label}
										</span>
									</button>
								);
							})
						)}
					</div>
				</div>

				<DropdownMenuSeparator className="mx-0 my-0" />
				<div className="p-1">
					<DropdownMenuLabel className="text-xs text-muted-foreground">
						Fast mode
					</DropdownMenuLabel>
					<div className="flex items-center justify-between gap-3 px-2 pt-0.5 pb-1.5">
						<span
							className={cn(
								"flex items-center gap-2 text-sm",
								!canFast && "text-muted-foreground",
							)}
						>
							<AnimatedZap active={fast && canFast} className="size-4" />
							Enable fast mode
						</span>
						<Switch
							checked={fast}
							disabled={!canFast}
							onCheckedChange={(checked) => onChange(withFast(base, checked))}
						/>
					</div>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
