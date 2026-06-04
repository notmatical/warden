import { Boxes, type LucideIcon, Plug2 } from "lucide-react";
import { type ComponentType, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { IntegrationsSection } from "./sections/integrations-section";
import { ProvidersSection } from "./sections/providers-section";

interface Section {
	id: string;
	label: string;
	icon: LucideIcon;
	Component: ComponentType;
}

// Add a pane by appending here — the nav and content router are data-driven.
const SECTIONS: Section[] = [
	{ id: "providers", label: "Providers", icon: Boxes, Component: ProvidersSection },
	{
		id: "integrations",
		label: "Integrations",
		icon: Plug2,
		Component: IntegrationsSection,
	},
];

export function SettingsDialog() {
	const open = useAppStore((s) => s.settingsOpen);
	const setOpen = useAppStore((s) => s.setSettingsOpen);
	const requested = useAppStore((s) => s.settingsSection);

	const [active, setActive] = useState(requested);
	const [seenOpen, setSeenOpen] = useState(open);
	// Jump to the requested section each time the dialog opens.
	if (open !== seenOpen) {
		setSeenOpen(open);
		if (open) setActive(requested);
	}

	const Active =
		SECTIONS.find((s) => s.id === active)?.Component ?? ProvidersSection;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="grid h-[560px] w-[min(760px,calc(100vw-2rem))] max-w-none grid-cols-[180px_1fr] gap-0 overflow-hidden p-0 sm:max-w-none">
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<nav className="flex flex-col gap-0.5 border-r border-border/60 bg-muted/20 p-2">
					<p className="px-2 pt-1.5 pb-2.5 text-sm font-medium">Settings</p>
					{SECTIONS.map((section) => {
						const Icon = section.icon;
						const isActive = section.id === active;
						return (
							<button
								key={section.id}
								type="button"
								onClick={() => setActive(section.id)}
								className={cn(
									"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
									isActive
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
								)}
							>
								<Icon className="size-4 shrink-0" />
								{section.label}
							</button>
						);
					})}
				</nav>
				<div className="min-w-0 overflow-y-auto">
					<Active />
				</div>
			</DialogContent>
		</Dialog>
	);
}
