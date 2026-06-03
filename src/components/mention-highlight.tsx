import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// `@file`, `/command`, `#ref` at line start or after whitespace.
const TOKEN_RE = /(^|\s)([@/#][^\s]+)/g;

// Background tint + color only — no font-weight or padding, so the highlighted
// token keeps the exact same width as the plain text in the textarea above it.
const TOKEN_STYLE: Record<string, string> = {
	"@": "bg-sky-400/15 text-sky-300",
	"/": "bg-violet-400/15 text-violet-300",
	"#": "bg-emerald-400/15 text-emerald-300",
};

/**
 * Renders the composer text with mention tokens colored. Used as a backdrop
 * behind a transparent textarea so the highlight lines up with what's typed.
 */
export function MentionHighlight({ value }: { value: string }) {
	const nodes: ReactNode[] = [];
	let last = 0;
	let key = 0;
	let match: RegExpExecArray | null;

	TOKEN_RE.lastIndex = 0;
	while ((match = TOKEN_RE.exec(value)) !== null) {
		const tokenStart = match.index + match[1].length;
		if (tokenStart > last) {
			nodes.push(
				<Fragment key={key++}>{value.slice(last, tokenStart)}</Fragment>,
			);
		}
		const token = match[2];
		nodes.push(
			<span
				key={key++}
				className={cn("rounded", TOKEN_STYLE[token[0]] ?? "text-foreground")}
			>
				{token}
			</span>,
		);
		last = tokenStart + token.length;
	}

	if (last < value.length) {
		nodes.push(<Fragment key={key++}>{value.slice(last)}</Fragment>);
	}
	// Zero-width char keeps a trailing newline's height in sync with the textarea.
	nodes.push("​");

	return <>{nodes}</>;
}
