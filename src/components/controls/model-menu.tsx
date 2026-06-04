import { Check, ChevronsUpDown, Search } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useState } from "react";

import { AnimatedZap } from "@/components/animated-zap";
import { AnthropicIcon, OpenAIIcon } from "@/components/icons/brand";
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

interface ProviderEntry {
	name: string;
	backend: Backend;
}

/** A provider's brand mark, shown in the rail when more than one is usable. */
const PROVIDER_ICON: Record<Backend, ComponentType<SVGProps<SVGSVGElement>>> = {
	claude: AnthropicIcon,
	codex: OpenAIIcon,
};

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

	// Which providers can be picked right now: once a turn has run the backend is
	// fixed to one provider; otherwise every authed provider is selectable.
	const authed = new Set(providers.filter((p) => p.authed).map((p) => p.id));
	const usable = started
		? PROVIDER_ENTRIES.filter((e) => e.backend === backend)
		: PROVIDER_ENTRIES.filter((e) => authed.has(e.backend));
	// Fall back to the session's own provider so the menu is never empty (e.g.
	// before provider status has loaded).
	const entries =
		usable.length > 0
			? usable
			: PROVIDER_ENTRIES.filter((e) => e.backend === backend);
	// Only worth a provider rail when there's more than one to switch between.
	const showRail = entries.length > 1;

	const [pane, setPane] = useState(activeProvider);
	const [query, setQuery] = useState("");
	const [seenOpen, setSeenOpen] = useState(open);
	if (open !== seenOpen) {
		setSeenOpen(open);
		if (open) {
			setPane(activeProvider);
			setQuery("");
		}
	}
	const paneName = entries.some((e) => e.name === pane)
		? pane
		: entries.some((e) => e.name === activeProvider)
			? activeProvider
			: entries[0].name;

	const selectPane = (name: string) => {
		setPane(name);
		setQuery("");
	};

	const q = query.trim().toLowerCase();
	const paneModels = MODELS.filter((m) => m.provider === paneName).filter(
		(m) =>
			!q ||
			m.label.toLowerCase().includes(q) ||
			m.id.toLowerCase().includes(q),
	);

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
			<DropdownMenuContent
				align="start"
				className={cn("p-0", showRail ? "w-[22rem]" : "w-72")}
			>
				<div className="flex items-center gap-2 border-b border-border/50 px-2.5">
					<Search className="size-3.5 shrink-0 text-muted-foreground" />
					{/* Stop key events bubbling so the menu's typeahead doesn't steal them. */}
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.stopPropagation()}
						placeholder="Search models"
						className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>

				<div className="flex">
					{showRail ? (
						<div className="flex w-12 shrink-0 flex-col gap-1 border-r border-border/50 p-1.5">
							{entries.map((entry) => {
								const Icon = PROVIDER_ICON[entry.backend];
								const selected = entry.name === paneName;
								return (
									<button
										key={entry.name}
										type="button"
										aria-label={entry.name}
										title={entry.name}
										onClick={() => selectPane(entry.name)}
										className={cn(
											"flex aspect-square items-center justify-center rounded-md transition-colors",
											selected
												? "bg-accent text-accent-foreground"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
									>
										<Icon className="size-4" />
									</button>
								);
							})}
						</div>
					) : null}

					<div className="min-w-0 flex-1 overflow-y-auto p-1 max-h-72">
						{paneModels.length === 0 ? (
							<p className="px-2 py-6 text-center text-sm text-muted-foreground">
								No models found
							</p>
						) : (
							paneModels.map((model) => {
								const selected = model.id === base;
								return (
									<button
										key={model.id}
										type="button"
										onClick={() => onChange(withFast(model.id, fast))}
										className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-hidden transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
									>
										<span className="min-w-0 flex-1 truncate">
											{model.label}
										</span>
										<Check
											className={cn(
												"size-4 shrink-0",
												selected ? "opacity-100" : "opacity-0",
											)}
										/>
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
