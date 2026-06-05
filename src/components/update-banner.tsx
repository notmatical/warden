import { ArrowUp, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";

const DISMISS_KEY = "warden:dismissed-updates";

function readDismissed(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}");
	} catch {
		return {};
	}
}

/** Sits above the settings button and surfaces an available CLI update. Driven
 *  by provider status (`updateAvailable`); dismissals are remembered per version,
 *  so a newer release re-surfaces it. */
export function UpdateBanner() {
	const providers = useAppStore((s) => s.providers);
	const updateProvider = useAppStore((s) => s.updateProvider);
	const [dismissed, setDismissed] = useState(readDismissed);
	const [updating, setUpdating] = useState(false);

	// The first available update the user hasn't dismissed at its current version.
	const pending = providers.find(
		(p) => p.updateAvailable && dismissed[p.id] !== (p.latestVersion ?? ""),
	);
	if (!pending) return null;

	const dismiss = () => {
		const next = { ...dismissed, [pending.id]: pending.latestVersion ?? "" };
		setDismissed(next);
		try {
			localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
		} catch {
			// ignore storage failures
		}
	};

	const update = async () => {
		setUpdating(true);
		await updateProvider(pending.id);
		setUpdating(false);
	};

	return (
		<div className="mb-2 rounded-lg border border-border/60 bg-muted/40 p-3">
			<div className="flex items-start gap-2.5">
				<span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-foreground/70">
					<ArrowUp className="size-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-[13px] font-medium text-foreground">
						Update available
					</p>
					<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{pending.name} {pending.latestVersion} is ready to install.
					</p>
				</div>
				<button
					type="button"
					aria-label="Dismiss"
					onClick={dismiss}
					className="-mt-0.5 -mr-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			</div>
			<Button
				size="sm"
				disabled={updating}
				onClick={() => void update()}
				className="mt-2.5 h-7 w-full gap-1.5 bg-foreground text-xs text-background hover:bg-foreground/90"
			>
				{updating ? (
					<>
						<Loader2 className="size-3.5 animate-spin" />
						Updating…
					</>
				) : (
					"Update"
				)}
			</Button>
		</div>
	);
}
