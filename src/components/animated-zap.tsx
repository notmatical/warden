import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A lightning bolt that fills, glows amber, and pops once when it becomes
 * active — used to signal the fast service tier. The `key` flip remounts the
 * icon on each activation so the one-shot pop replays.
 */
export function AnimatedZap({
	active,
	className,
}: {
	active?: boolean;
	className?: string;
}) {
	return (
		<Zap
			key={active ? "on" : "off"}
			aria-hidden
			className={cn(
				"transition-all duration-300",
				active
					? "zap-pop fill-amber-500 text-amber-500 drop-shadow-[0_0_4px_rgba(245,158,11,0.55)]"
					: "fill-transparent text-muted-foreground",
				className,
			)}
		/>
	);
}
