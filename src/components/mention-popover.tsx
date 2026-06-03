import { useEffect, useRef } from "react";
import type { MentionItem } from "@/lib/mentions";
import { cn } from "@/lib/utils";

interface MentionPopoverProps {
	items: MentionItem[];
	selectedIndex: number;
	loading: boolean;
	emptyLabel: string;
	onSelect: (item: MentionItem) => void;
	onHighlight: (index: number) => void;
	className?: string;
}

export function MentionPopover({
	items,
	selectedIndex,
	loading,
	emptyLabel,
	onSelect,
	onHighlight,
	className,
}: MentionPopoverProps) {
	const listRef = useRef<HTMLDivElement>(null);

	// Keep the highlighted row visible during keyboard navigation.
	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>("[data-selected='true']")
			?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	return (
		<div
			ref={listRef}
			className={cn(
				"max-h-64 overflow-y-auto rounded-lg border border-border/80 bg-popover p-1 shadow-md",
				className,
			)}
		>
			{items.length === 0 ? (
				<div className="px-2 py-2 text-xs text-muted-foreground">
					{loading ? "Loading…" : emptyLabel}
				</div>
			) : (
				items.map((item, index) => (
					<button
						key={item.id}
						type="button"
						data-selected={index === selectedIndex}
						// mousedown (not click) so the textarea keeps focus through selection.
						onMouseDown={(event) => {
							event.preventDefault();
							onSelect(item);
						}}
						onMouseEnter={() => onHighlight(index)}
						className={cn(
							"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
							index === selectedIndex
								? "bg-accent text-accent-foreground"
								: "text-foreground",
						)}
					>
						<span className="shrink-0 truncate text-sm font-medium">
							{item.label}
						</span>
						{item.detail && (
							<span className="truncate text-xs text-muted-foreground">
								{item.detail}
							</span>
						)}
					</button>
				))
			)}
		</div>
	);
}
