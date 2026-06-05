import { useEffect, useMemo, useState } from "react";

import {
	type Highlighted,
	highlightTokens,
	langFromPath,
} from "@/lib/shiki";
import { cn } from "@/lib/utils";

type RowKind = "add" | "del" | "ctx" | "hunk";

interface DiffRow {
	kind: RowKind;
	/** New-file line number for add/ctx rows. */
	num?: number;
	/** Code content (prefix stripped) for add/del/ctx; raw text for hunk. */
	text: string;
	/** Index into the highlighted code lines (add/del/ctx only). */
	codeIndex: number;
}

/** Split a unified patch into rows plus the bare code lines (in order) for
 *  syntax highlighting. Handles hunk headers (`@@`) for absolute line numbers;
 *  hunkless patches (a Claude edit, a synthesized all-add file) number from 1. */
function parseDiff(patch: string): { rows: DiffRow[]; code: string[] } {
	const rows: DiffRow[] = [];
	const code: string[] = [];
	let newNo = 1;

	for (const line of patch.split("\n")) {
		if (line.startsWith("@@")) {
			const m = /\+(\d+)/.exec(line);
			if (m) newNo = Number(m[1]);
			rows.push({ kind: "hunk", text: line, codeIndex: -1 });
			continue;
		}
		if (line.startsWith("+++") || line.startsWith("---")) continue;

		let kind: RowKind = "ctx";
		let text = line;
		if (line.startsWith("+")) {
			kind = "add";
			text = line.slice(1);
		} else if (line.startsWith("-")) {
			kind = "del";
			text = line.slice(1);
		} else if (line.startsWith(" ")) {
			text = line.slice(1);
		}

		const codeIndex = code.length;
		code.push(text);
		rows.push({
			kind,
			text,
			codeIndex,
			num: kind === "del" ? undefined : newNo++,
		});
	}

	return { rows, code };
}

function useHighlighted(code: string[], lang: string): Highlighted | null {
	const joined = useMemo(() => code.join("\n"), [code]);
	const [hl, setHl] = useState<Highlighted | null>(null);
	useEffect(() => {
		let active = true;
		void highlightTokens(joined, lang).then((r) => {
			if (active) setHl(r);
		});
		return () => {
			active = false;
		};
	}, [joined, lang]);
	return hl;
}

const SIGN = { add: "+", del: "−", ctx: "" } as const;
const SIGN_CLASS = {
	add: "text-emerald-400",
	del: "text-rose-400",
	ctx: "",
} as const;

/** The highlighted diff surface — colored rows with a sign + line-number gutter
 *  on the app's warm `--code` surface. Owns no scrolling/border; a wrapper
 *  provides those. */
export function DiffLines({
	patch,
	path,
	lang,
}: {
	patch: string;
	path?: string;
	lang?: string;
}) {
	const { rows, code } = useMemo(() => parseDiff(patch), [patch]);
	const hl = useHighlighted(code, lang ?? langFromPath(path));

	return (
		<div className="w-max min-w-full bg-code font-mono text-[12px] leading-[1.6] text-code-foreground">
			{rows.map((row, i) => {
				if (row.kind === "hunk") {
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional
							key={i}
							className="px-3 py-0.5 whitespace-pre text-muted-foreground/70 select-none"
						>
							{row.text}
						</div>
					);
				}
				const tokens = hl?.lines[row.codeIndex];
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional
						key={i}
						className={cn(
							"flex",
							row.kind === "add" && "bg-emerald-500/[0.1]",
							row.kind === "del" && "bg-rose-500/[0.1]",
						)}
					>
						<span
							className={cn(
								"w-4 shrink-0 text-center select-none",
								SIGN_CLASS[row.kind],
							)}
						>
							{SIGN[row.kind]}
						</span>
						<span className="w-9 shrink-0 pr-3 text-right text-[11px] text-muted-foreground/40 tabular-nums select-none">
							{row.num ?? ""}
						</span>
						<code className="flex-1 pr-4 whitespace-pre">
							{tokens
								? tokens.map((t, ti) => (
										<span
											// biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
											key={ti}
											style={{
												color: t.color,
												fontStyle: t.italic ? "italic" : undefined,
											}}
										>
											{t.content}
										</span>
									))
								: row.text || " "}
						</code>
					</div>
				);
			})}
		</div>
	);
}

/** A self-contained diff panel: a file-path header over a scrollable,
 *  height-capped syntax-highlighted patch. */
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
				"overflow-hidden rounded-lg border border-border/60",
				className,
			)}
		>
			{path ? (
				<div
					className="truncate border-b border-border/60 bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
					title={path}
				>
					{path}
				</div>
			) : null}
			<div className="max-h-72 overflow-auto">
				<DiffLines patch={patch} path={path} />
			</div>
		</div>
	);
}
