import { cn } from "@/lib/utils";

type Edge = "top" | "bottom" | "left" | "right";

const EDGE: Record<Edge, string> = {
	top: "inset-x-0 top-0 h-6 bg-gradient-to-b",
	bottom: "inset-x-0 bottom-0 h-6 bg-gradient-to-t",
	left: "inset-y-0 left-0 w-6 bg-gradient-to-r",
	right: "inset-y-0 right-0 w-6 bg-gradient-to-l",
};

export function EdgeFade({
	edge,
	className,
}: {
	edge: Edge;
	className?: string;
}) {
	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none absolute z-10 from-background to-transparent",
				EDGE[edge],
				className,
			)}
		/>
	);
}
