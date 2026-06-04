import { CornerDownLeft, GitBranch, GitMerge, Square } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { EffortMenu } from "@/components/controls/effort-menu";
import { ModeMenu } from "@/components/controls/mode-menu";
import { ModelMenu } from "@/components/controls/model-menu";
import { GitStatusChips } from "@/components/git-status-chips";
import { MentionHighlight } from "@/components/mention-highlight";
import { MentionPopover } from "@/components/mention-popover";
import { PermissionApproval } from "@/components/permission-approval";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitStatus } from "@/hooks/use-git-status";
import { useMentions } from "@/hooks/use-mentions";
import { useUiCommand } from "@/hooks/use-ui-command";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

const MAX_TEXTAREA_HEIGHT = 200;
// Shared typography/padding so the highlight backdrop lines up with the textarea.
// Shared box + typography + wrapping so the backdrop and textarea lay text out
// identically (any divergence shifts the caret off the highlighted token).
const INPUT_BOX =
	"py-3 pr-1 pl-3.5 text-sm leading-5 tracking-normal break-words whitespace-pre-wrap";

export function Composer({ sessionId }: { sessionId: string }) {
	const session = useAppStore((s) => s.sessions[sessionId]);
	const sendMessage = useAppStore((s) => s.sendMessage);
	const cancel = useAppStore((s) => s.cancel);
	const updateSession = useAppStore((s) => s.updateSession);
	const setIsolation = useAppStore((s) => s.setIsolation);
	const projectIsGit = useAppStore((s) => {
		const projectId = session?.projectId;
		if (!projectId) return false;
		for (const roots of Object.values(s.rootsByGroup)) {
			const root = roots.find((p) => p.id === projectId);
			if (root) return root.isGit;
		}
		return false;
	});
	const [value, setValue] = useState("");
	// Only one toolbar menu open at a time.
	const [openMenu, setOpenMenu] = useState<"model" | "mode" | "effort" | null>(
		null,
	);
	const menuProps = (id: "model" | "mode" | "effort") => ({
		open: openMenu === id,
		onOpenChange: (open: boolean) => setOpenMenu(open ? id : null),
	});

	// Ctrl+E toggles this session's model menu when it's the active session.
	useUiCommand<string>("composer.toggleModelMenu", (targetSessionId) => {
		if (targetSessionId === sessionId) {
			setOpenMenu((current) => (current === "model" ? null : "model"));
		}
	});
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);

	const mentions = useMentions({
		value,
		onChange: setValue,
		textareaRef,
		workingDir: session?.workingDir ?? null,
	});

	const { statuses, refresh } = useGitStatus(sessionId);

	// A live tool-approval request: the latest event is a permission_request the
	// user hasn't acted on. While pending it takes the chip row's slot.
	const pendingApproval = useAppStore((s) => {
		const events = s.eventsBySession[sessionId];
		const last = events?.[events.length - 1];
		if (last?.type !== "permission_request") return null;
		return s.approvalResolvedBySession[sessionId] === last.id ? null : last;
	});

	// Grow the textarea with its content, from a single line up to a cap.
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
	}, [value]);

	const running = session?.status === "running";
	const canSend = value.trim().length > 0 && !running;

	if (!session) {
		return null;
	}

	// A merged session's worktree is gone — it becomes read-only.
	if (session.mergedAt) {
		return (
			<div className="mx-auto w-full max-w-6xl px-3 pb-3">
				<div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
					<GitMerge className="size-3.5" />
					Merged into {session.baseBranch ?? "base"} · read-only
				</div>
			</div>
		);
	}

	const isolated = session.isIsolated;
	const started = session.turns > 0;
	const canToggleIsolation = projectIsGit && !started;
	const isolationTip = !projectIsGit
		? "Worktree isolation needs a git repository."
		: started
			? `This session runs in ${isolated ? "an isolated worktree" : "the project checkout"} — fixed once it has started.`
			: isolated
				? "Isolated in a git worktree. Click to run in the project checkout instead."
				: "Runs in the project checkout. Click to isolate in a git worktree so the agent's changes stay on a separate branch.";

	const submit = () => {
		if (!canSend) return;
		const text = value.trim();
		setValue("");
		void sendMessage(sessionId, text);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<div className="mx-auto w-full max-w-6xl px-3 pb-3">
			<div className="flex flex-col">
				{pendingApproval ? (
					<PermissionApproval
						sessionId={sessionId}
						eventId={pendingApproval.id}
						denials={pendingApproval.denials}
					/>
				) : (
					<GitStatusChips
						statuses={statuses}
						sessionId={sessionId}
						refresh={refresh}
					/>
				)}
				{/* Input card — single, solid surface, on top. Send/stop lives inline
            on the right as a ghost icon. */}
				<div className="relative z-10 flex items-end gap-1 rounded-xl border border-border/60 bg-card pr-1.5 transition-colors focus-within:border-border/80">
					{mentions.active && (
						<MentionPopover
							items={mentions.items}
							selectedIndex={mentions.selectedIndex}
							loading={mentions.loading}
							emptyLabel={mentions.emptyLabel}
							onSelect={mentions.select}
							onHighlight={mentions.setSelectedIndex}
							className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md"
						/>
					)}
					{/* Highlight backdrop + transparent textarea: mention tokens are
              colored on the backdrop and show through the textarea. */}
					<div className="relative min-w-0 flex-1">
						<div
							ref={backdropRef}
							aria-hidden
							className={cn(
								"pointer-events-none absolute inset-0 overflow-hidden text-foreground",
								INPUT_BOX,
							)}
						>
							<MentionHighlight value={value} />
						</div>
						<textarea
							ref={textareaRef}
							value={value}
							onChange={(e) => {
								setValue(e.target.value);
								mentions.handleInput(
									e.target.value,
									e.target.selectionStart ?? 0,
								);
							}}
							onKeyDown={(e) => {
								if (mentions.handleKeyDown(e)) return;
								handleKeyDown(e);
							}}
							onScroll={(e) => {
								if (backdropRef.current) {
									backdropRef.current.scrollTop = e.currentTarget.scrollTop;
								}
							}}
							disabled={running}
							rows={1}
							placeholder={
								running
									? "Agent is working…"
									: "Message the agent…  (Enter to send)"
							}
							className={cn(
								"relative block max-h-[200px] w-full resize-none bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60",
								INPUT_BOX,
							)}
						/>
					</div>
					{running ? (
						<Button
							size="icon-sm"
							variant="ghost"
							onClick={() => void cancel(sessionId)}
							aria-label="Stop the agent"
							className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
						>
							<Square />
						</Button>
					) : (
						<Button
							size="icon-sm"
							variant="ghost"
							onClick={submit}
							disabled={!canSend}
							aria-label="Send message"
							className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
						>
							<CornerDownLeft />
						</Button>
					)}
				</div>

				{/* Attached settings panel — tucked behind the card, tinted. */}
				<div className="-mt-3 flex items-center gap-1 rounded-b-xl bg-muted/40 px-2 pt-5 pb-1.5">
					<ModelMenu
						value={session.model}
						backend={session.backend}
						started={started}
						onChange={(model) => void updateSession(sessionId, { model })}
						{...menuProps("model")}
					/>
					<div className="mx-0.5 h-4 w-px bg-border/60" />
					<ModeMenu
						value={session.permissionMode}
						onChange={(permissionMode) =>
							void updateSession(sessionId, { permissionMode })
						}
						{...menuProps("mode")}
					/>
					<EffortMenu
						value={session.effort}
						onChange={(effort) => void updateSession(sessionId, { effort })}
						{...menuProps("effort")}
					/>

					<Tooltip>
						<TooltipTrigger asChild>
							<span className="ml-auto inline-flex">
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									disabled={!canToggleIsolation}
									aria-pressed={isolated}
									onClick={() => void setIsolation(sessionId, !isolated)}
									className={cn(
										isolated ? "text-primary" : "text-muted-foreground",
									)}
								>
									<GitBranch />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent className="max-w-56">{isolationTip}</TooltipContent>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}
