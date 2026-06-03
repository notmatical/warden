import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types";

const STATUS_STYLES: Record<SessionStatus, string> = {
	idle: "bg-muted-foreground/60",
	running: "bg-amber-500",
	error: "bg-destructive",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
	idle: "Idle",
	running: "Running",
	error: "Error",
};

export function StatusDot({
	status,
	className,
}: {
	status: SessionStatus;
	className?: string;
}) {
	return (
		<span
			className={cn("relative inline-flex size-2 shrink-0", className)}
			role="status"
			aria-label={STATUS_LABEL[status]}
			title={STATUS_LABEL[status]}
		>
			{status === "running" && (
				<span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500/70" />
			)}
			<span
				className={cn(
					"relative inline-flex size-2 rounded-full",
					STATUS_STYLES[status],
				)}
			/>
		</span>
	);
}
