import { cn } from "@/lib/utils";

/** Per-line tone for a unified-diff line. */
function lineTone(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) {
		return "text-muted-foreground/70";
	}
	if (line.startsWith("@@")) return "text-sky-500";
	if (line.startsWith("+")) {
		return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
	}
	if (line.startsWith("-")) {
		return "bg-red-500/10 text-red-600 dark:text-red-400";
	}
	return "text-muted-foreground/90";
}

/** A unified-diff patch rendered with per-line add/remove/hunk coloring. The
 *  caller owns scrolling — this is just the colored `<pre>`. */
export function DiffLines({ patch }: { patch: string }) {
	return (
		<pre className="m-0 w-full overflow-x-auto py-1.5 font-mono text-[11px] leading-[1.5]">
			{patch.split("\n").map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
				<div key={i} className={cn("whitespace-pre px-3", lineTone(line))}>
					{line || " "}
				</div>
			))}
		</pre>
	);
}

/** A self-contained diff panel: an optional file-path header over a scrollable,
 *  height-capped colored patch. */
export function DiffView({
	path,
	patch,
	className,
}: {
	path?: string;
	patch: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-border/60 bg-background/40",
				className,
			)}
		>
			{path ? (
				<div
					className="truncate border-b border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
					title={path}
				>
					{path}
				</div>
			) : null}
			<div className="max-h-64 overflow-auto">
				<DiffLines patch={patch} />
			</div>
		</div>
	);
}
