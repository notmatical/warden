import { Check, Copy } from "lucide-react";
import { memo, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { copyText } from "@/lib/clipboard";
import { highlightCode } from "@/lib/shiki";
import { cn } from "@/lib/utils";

/** Recursively flatten a React node tree to its text content. */
function nodeText(node: ReactNode): string {
	if (node == null || node === false) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(nodeText).join("");
	if (typeof node === "object" && "props" in node) {
		return nodeText(
			(node as { props: { children?: ReactNode } }).props.children,
		);
	}
	return "";
}

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label="Copy code"
			onClick={async () => {
				if (await copyText(value, "")) {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}
			}}
			className="absolute top-2 right-2 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background/80 hover:text-foreground"
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</button>
	);
}

/** A fenced code block: Shiki-highlighted with a plain `<pre>` fallback while
 *  highlighting resolves (or if the grammar is unknown). */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		void highlightCode(code, lang).then((result) => {
			if (active) setHtml(result);
		});
		return () => {
			active = false;
		};
	}, [code, lang]);

	return (
		<div className="group not-prose relative my-3 text-[13px]">
			{html ? (
				<div
					className="overflow-x-auto rounded-lg [&>pre]:rounded-lg [&>pre]:p-3.5"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="overflow-x-auto rounded-lg bg-muted p-3.5 font-mono">
					{code}
				</pre>
			)}
			<CopyButton value={code} />
		</div>
	);
}

const COMPONENTS: Components = {
	code({ className, children, ...props }) {
		const match = /language-(\w+)/.exec(className ?? "");
		const text = nodeText(children);
		const isBlock = match != null || text.includes("\n");
		if (isBlock) {
			return <CodeBlock code={text.replace(/\n$/, "")} lang={match?.[1]} />;
		}
		return (
			<code
				className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
				{...props}
			>
				{children}
			</code>
		);
	},
	// CodeBlock renders its own <pre>, so collapse the wrapper.
	pre({ children }) {
		return <>{children}</>;
	},
	a({ children, href }) {
		return (
			<a href={href} target="_blank" rel="noreferrer noopener">
				{children}
			</a>
		);
	},
};

export const Markdown = memo(function Markdown({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"prose prose-sm max-w-none break-words dark:prose-invert",
				// Slightly heavier body text + fuller contrast for readability.
				"font-[450] prose-p:text-foreground/90 prose-li:text-foreground/90",
				"prose-pre:bg-transparent prose-pre:p-0",
				"prose-headings:font-semibold prose-p:leading-relaxed",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeRaw]}
				components={COMPONENTS}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
});
