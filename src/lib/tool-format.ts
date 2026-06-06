import { diffLines } from "diff";

/** A tool call's paired result, when one has arrived. */
export interface ToolResult {
	content: string;
	isError: boolean;
}

export interface TodoItem {
	content: string;
	status: "pending" | "in_progress" | "completed";
}

/** The expandable body under a tool's summary line. Discriminated by `kind` so
 *  the renderer picks the right panel (colored diff, code, terminal, …). */
export type ToolDetail =
	| { kind: "diff"; path?: string; patch: string }
	| { kind: "code"; path?: string; text: string }
	| { kind: "terminal"; command: string; output: string; isError: boolean }
	| { kind: "todos"; todos: TodoItem[] }
	| { kind: "text"; text: string };

/** A normalized, presentation-ready view of one tool call. */
export interface ToolView {
	/** Past-tense action word, e.g. "Read", "Edited", "Ran". */
	verb: string;
	/** The subject — a file path, command, or query. The full string (used for
	 *  the tooltip); shown in mono. */
	target?: string;
	/** A shorter display form of `target` (e.g. a path's last segments), so the
	 *  filename survives truncation. Falls back to `target` when unset. */
	label?: string;
	added?: number;
	removed?: number;
	detail?: ToolDetail;
}

function asStr(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A path's last two segments (handling both `/` and `\`), so a long absolute
 *  path truncates without hiding the filename. */
function shortenPath(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const segments = path.split(/[/\\]/).filter(Boolean);
	if (segments.length <= 2) return path;
	return segments.slice(-2).join("/");
}

/** Drop the working-directory prefix from `path` for display. Case-insensitive
 *  on the prefix (Windows), tolerant of mixed `/` and `\` separators; restores
 *  the original separator style. Falls back to the absolute path when `path`
 *  doesn't live under `base`. */
export function pathRelativeTo(
	path: string | undefined,
	base: string | undefined,
): string | undefined {
	if (!path) return path;
	if (!base) return path;
	const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
	const p = norm(path);
	const b = norm(base);
	if (!b) return path;
	const lp = p.toLowerCase();
	const lb = b.toLowerCase();
	if (lp === lb) return "";
	if (lp.startsWith(`${lb}/`)) {
		const rel = p.slice(b.length + 1);
		return path.includes("\\") ? rel.replace(/\//g, "\\") : rel;
	}
	return path;
}

/** A file view: full path in `target` (tooltip), tail in `label` (display). */
function fileView(
	verb: string,
	path: string | undefined,
	extra?: Partial<ToolView>,
): ToolView {
	return { verb, target: path, label: shortenPath(path), ...extra };
}

/** First changed file path in a Codex `Edit` input (`{ changes: [{ path }] }`). */
function firstChangePath(changes: unknown): string | undefined {
	if (!Array.isArray(changes)) return undefined;
	for (const c of changes) {
		if (c && typeof c === "object" && "path" in c) {
			const p = asStr((c as { path?: unknown }).path);
			if (p) return p;
		}
	}
	return undefined;
}

/** Split a diff segment into lines, dropping the trailing "" from its final
 *  newline so a 3-line value doesn't yield 4 entries. */
function segmentLines(value: string): string[] {
	const lines = value.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** Line-diff two strings (a Claude `Edit`'s old/new) into a prefixed patch plus
 *  add/remove counts. */
function editToPatch(oldStr: string, newStr: string): {
	patch: string;
	added: number;
	removed: number;
} {
	let added = 0;
	let removed = 0;
	const out: string[] = [];
	for (const part of diffLines(oldStr, newStr)) {
		const sign = part.added ? "+" : part.removed ? "-" : " ";
		for (const line of segmentLines(part.value)) {
			out.push(sign + line);
			if (part.added) added++;
			else if (part.removed) removed++;
		}
	}
	return { patch: out.join("\n"), added, removed };
}

/** Count add/remove lines in an already-unified patch (a Codex `Edit`'s diff,
 *  which arrives in the result rather than the input). */
function countPatch(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

function parseTodos(value: unknown): TodoItem[] {
	if (!Array.isArray(value)) return [];
	const out: TodoItem[] = [];
	for (const t of value) {
		if (!t || typeof t !== "object") continue;
		const content = asStr((t as { content?: unknown }).content);
		if (!content) continue;
		const status = (t as { status?: unknown }).status;
		out.push({
			content,
			status:
				status === "in_progress" || status === "completed"
					? status
					: "pending",
		});
	}
	return out;
}

/** Normalize a tool call into a renderable view. Handles both Claude and Codex
 *  shapes (notably `Edit`, whose diff is in the input for Claude but the result
 *  for Codex); unknown tools fall back to a generic name + raw I/O panel. */
export function describeTool(
	name: string,
	input: unknown,
	result?: ToolResult,
): ToolView {
	const inp = (input && typeof input === "object" ? input : {}) as Record<
		string,
		unknown
	>;

	switch (name) {
		case "Read": {
			const path = asStr(inp.file_path) ?? asStr(inp.path);
			return fileView("Read", path, {
				detail: result?.content
					? { kind: "code", path, text: result.content }
					: undefined,
			});
		}

		case "Edit": {
			const path = asStr(inp.file_path) ?? firstChangePath(inp.changes);
			const oldStr = inp.old_string;
			const newStr = inp.new_string;
			// Claude: diff the old/new strings from the input.
			if (typeof oldStr === "string" && typeof newStr === "string") {
				const { patch, added, removed } = editToPatch(oldStr, newStr);
				return fileView("Edited", path, {
					added,
					removed,
					detail: { kind: "diff", path, patch },
				});
			}
			// Codex: the unified diff arrives in the result.
			if (result?.content) {
				const { added, removed } = countPatch(result.content);
				return fileView("Edited", path, {
					added,
					removed,
					detail: { kind: "diff", path, patch: result.content },
				});
			}
			return fileView("Edited", path);
		}

		case "MultiEdit": {
			const path = asStr(inp.file_path);
			const edits = Array.isArray(inp.edits) ? inp.edits : [];
			let added = 0;
			let removed = 0;
			const patches: string[] = [];
			for (const e of edits) {
				if (!e || typeof e !== "object") continue;
				const o = (e as { old_string?: unknown }).old_string;
				const n = (e as { new_string?: unknown }).new_string;
				if (typeof o !== "string" || typeof n !== "string") continue;
				const part = editToPatch(o, n);
				patches.push(part.patch);
				added += part.added;
				removed += part.removed;
			}
			return fileView("Edited", path, {
				added,
				removed,
				detail: patches.length
					? { kind: "diff", path, patch: patches.join("\n\n") }
					: undefined,
			});
		}

		case "Write": {
			const path = asStr(inp.file_path) ?? asStr(inp.path);
			const content = asStr(inp.content) ?? "";
			// A new file reads as an all-addition diff (green, line-numbered).
			const lines = content.replace(/\n$/, "");
			const patch = lines
				? lines
						.split("\n")
						.map((l) => `+${l}`)
						.join("\n")
				: "";
			return fileView("Wrote", path, {
				added: lines ? lines.split("\n").length : 0,
				detail: patch ? { kind: "diff", path, patch } : undefined,
			});
		}

		case "NotebookEdit": {
			const path = asStr(inp.notebook_path) ?? asStr(inp.file_path);
			const content = asStr(inp.new_source) ?? "";
			return fileView("Edited", path, {
				detail: content ? { kind: "code", path, text: content } : undefined,
			});
		}

		case "Bash": {
			const command = asStr(inp.command) ?? "";
			return {
				verb: "Ran",
				target: command,
				detail: {
					kind: "terminal",
					command,
					output: result?.content ?? "",
					isError: result?.isError ?? false,
				},
			};
		}

		case "Grep": {
			const pattern = asStr(inp.pattern) ?? "";
			return {
				verb: "Searched",
				target: pattern,
				detail: result?.content ? { kind: "text", text: result.content } : undefined,
			};
		}

		case "Glob": {
			const pattern = asStr(inp.pattern) ?? "";
			return {
				verb: "Globbed",
				target: pattern,
				detail: result?.content ? { kind: "text", text: result.content } : undefined,
			};
		}

		case "WebFetch": {
			return {
				verb: "Fetched",
				target: asStr(inp.url),
				detail: result?.content ? { kind: "text", text: result.content } : undefined,
			};
		}

		case "WebSearch": {
			return {
				verb: "Searched",
				target: asStr(inp.query),
				detail: result?.content ? { kind: "text", text: result.content } : undefined,
			};
		}

		case "TodoWrite": {
			const todos = parseTodos(inp.todos);
			return {
				verb: "Updated plan",
				detail: todos.length ? { kind: "todos", todos } : undefined,
			};
		}

		default: {
			// Unknown tool (incl. MCP `server/tool`): show the name and raw I/O.
			let text = "";
			if (input !== null && input !== undefined) {
				try {
					text =
						typeof input === "string" ? input : JSON.stringify(input, null, 2);
				} catch {
					text = String(input);
				}
			}
			if (result?.content) {
				text = text ? `${text}\n\n${result.content}` : result.content;
			}
			return {
				verb: name,
				detail: text ? { kind: "text", text } : undefined,
			};
		}
	}
}
