import { Boxes, type LucideIcon, Plug2 } from "lucide-react";
import { type ComponentType } from "react";

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

/** The Settings tab body — the same nav + content the old dialog had, sized to
 *  fill the pane instead of a fixed modal. The "active section" lives in the
 *  store (`settingsSection`) so the user's last-viewed section is restored when
 *  they reopen the tab and so `openSettings("integrations")` works as a deep
 *  link from anywhere. */
export function SettingsPanel() {
	const active = useAppStore((s) => s.settingsSection);
	const setActive = useAppStore((s) => s.setSettingsSection);

	const Active =
		SECTIONS.find((s) => s.id === active)?.Component ?? ProvidersSection;

	return (
		<div className="grid h-full min-h-0 grid-cols-[180px_1fr]">
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
		</div>
	);
}
