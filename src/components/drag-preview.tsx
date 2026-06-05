import {
	AnthropicIcon,
	ClaudeIcon,
	CodexIcon,
	OpenAIIcon,
} from "@/components/icons/brand";
import { useAppStore } from "@/store/app-store";

/** The floating clone shown under the cursor while dragging a session — mirrors
 *  the tab's favicon + title. */
export function DragPreview({ sessionId }: { sessionId: string }) {
	const session = useAppStore((s) => s.sessions[sessionId]);
	if (!session) return null;

	const Brand =
		session.kind === "terminal"
			? session.backend === "codex"
				? CodexIcon
				: ClaudeIcon
			: session.backend === "codex"
				? OpenAIIcon
				: AnthropicIcon;

	return (
		<div className="flex max-w-52 items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-[13px] text-foreground shadow-lg">
			<Brand className="size-3.5 shrink-0 opacity-70" />
			<span className="truncate">{session.title}</span>
		</div>
	);
}
