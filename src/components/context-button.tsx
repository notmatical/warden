import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
	FilePlus,
	FileText,
	Folder,
	FolderPlus,
	Paperclip,
	Type,
	X,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import * as ipc from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { ContextSource, SessionContextSource } from "@/types";

function describe(source: ContextSource): {
	icon: ComponentType<{ className?: string }>;
	label: string;
	title?: string;
} {
	if (source.kind === "text") {
		return { icon: Type, label: source.label };
	}
	const tail = source.path.split(/[/\\]/).filter(Boolean).slice(-2).join("/");
	return {
		icon: source.kind === "dir" ? Folder : FileText,
		label: tail,
		title: source.path,
	};
}

/** Composer control for a session's injected context sources (files, folders,
 *  saved text). Changes take effect on the next turn. */
export function ContextButton({ sessionId }: { sessionId: string }) {
	const [sources, setSources] = useState<SessionContextSource[]>([]);
	const [open, setOpen] = useState(false);
	const [adding, setAdding] = useState(false);
	const [label, setLabel] = useState("");
	const [body, setBody] = useState("");

	const load = useCallback(() => {
		void ipc
			.listContextSources(sessionId)
			.then(setSources)
			.catch(() => {});
	}, [sessionId]);

	useEffect(() => load(), [load]);

	const add = async (source: ContextSource) => {
		try {
			await ipc.addContextSource(sessionId, source);
			load();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	};

	const pickPath = async (directory: boolean) => {
		const selected = await openDialog({ directory, multiple: false });
		if (typeof selected !== "string") return;
		await add(
			directory
				? { kind: "dir", path: selected }
				: { kind: "file", path: selected },
		);
	};

	const addText = async () => {
		if (!body.trim()) return;
		await add({ kind: "text", label: label.trim() || "Note", body: body.trim() });
		setLabel("");
		setBody("");
		setAdding(false);
	};

	const count = sources.length;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className={cn(
								"gap-1.5 px-2 text-muted-foreground hover:text-foreground",
								count > 0 && "text-foreground",
							)}
						>
							<Paperclip className="size-3.5" />
							{count > 0 ? (
								<span className="text-xs tabular-nums">{count}</span>
							) : null}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Context</TooltipContent>
			</Tooltip>
			<PopoverContent side="top" align="start" className="w-80 p-0">
				<div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
					<span className="text-sm font-medium text-foreground">Context</span>
					<span className="text-[11px] text-muted-foreground">
						{count} source{count === 1 ? "" : "s"}
					</span>
				</div>

				{sources.length > 0 ? (
					<ul className="max-h-60 divide-y divide-border/50 overflow-auto">
						{sources.map((entry) => {
							const { icon: Icon, label: text, title } = describe(entry.source);
							return (
								<li
									key={entry.id}
									className="flex items-center gap-2 px-3 py-2"
								>
									<Icon className="size-3.5 shrink-0 text-muted-foreground" />
									<span
										className={cn(
											"min-w-0 flex-1 truncate text-[13px]",
											!entry.enabled &&
												"text-muted-foreground/50 line-through",
										)}
										title={title}
									>
										{text}
									</span>
									<Switch
										checked={entry.enabled}
										onCheckedChange={(v) =>
											void ipc
												.setContextSourceEnabled(sessionId, entry.id, v)
												.then(load)
										}
										className="scale-90"
									/>
									<button
										type="button"
										onClick={() =>
											void ipc
												.removeContextSource(sessionId, entry.id)
												.then(load)
										}
										aria-label="Remove"
										className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
									>
										<X className="size-3.5" />
									</button>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="px-3 py-5 text-center text-xs text-muted-foreground">
						Attach files, folders, or notes to this agent's context.
					</p>
				)}

				{adding ? (
					<div className="flex flex-col gap-1.5 border-t border-border/60 p-2.5">
						<Input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Label (optional)"
							className="h-8 text-[13px] md:text-[13px]"
						/>
						<textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Paste text to add to the agent's context…"
							rows={3}
							className="resize-none rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-border"
						/>
						<div className="flex justify-end gap-1.5">
							<Button
								size="xs"
								variant="ghost"
								onClick={() => {
									setAdding(false);
									setLabel("");
									setBody("");
								}}
							>
								Cancel
							</Button>
							<Button
								size="xs"
								onClick={() => void addText()}
								disabled={!body.trim()}
								className="bg-foreground text-background hover:bg-foreground/90"
							>
								Add
							</Button>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-1 border-t border-border/60 p-1.5">
						<Button
							size="xs"
							variant="ghost"
							onClick={() => void pickPath(false)}
							className="flex-1 gap-1.5 text-muted-foreground hover:text-foreground"
						>
							<FilePlus className="size-3.5" />
							File
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={() => void pickPath(true)}
							className="flex-1 gap-1.5 text-muted-foreground hover:text-foreground"
						>
							<FolderPlus className="size-3.5" />
							Folder
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={() => setAdding(true)}
							className="flex-1 gap-1.5 text-muted-foreground hover:text-foreground"
						>
							<Type className="size-3.5" />
							Text
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
