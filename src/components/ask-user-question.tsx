import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface QuestionOption {
	label: string;
	description?: string;
}

interface Question {
	question: string;
	header?: string;
	multiSelect?: boolean;
	options: QuestionOption[];
}

/** Parse the AskUserQuestion tool input into questions (defensive — the shape
 *  comes straight off the agent stream). */
export function parseQuestions(input: unknown): Question[] {
	const qs = (input as { questions?: unknown })?.questions;
	return Array.isArray(qs) ? (qs as Question[]) : [];
}

/** Turn the user's selections into a plain-language reply for the agent — the
 *  agent, paused after asking, continues on this as the next user message. */
function formatReply(
	questions: Question[],
	picks: Record<number, Set<number>>,
	custom: Record<number, string>,
): string {
	return questions
		.map((q, qi) => {
			const typed = custom[qi]?.trim();
			const labels = typed
				? [typed]
				: [...(picks[qi] ?? [])]
						.map((oi) => q.options[oi]?.label)
						.filter((l): l is string => Boolean(l));
			return `For "${q.question}": ${labels.join(", ") || "(no preference)"}`;
		})
		.join("\n");
}

/** Interactive rendering of an agent's AskUserQuestion tool call, stepped one
 *  question at a time. Answering sends the reply as the next message; once
 *  replied it collapses to a marker (the answer shows as the following message). */
export function AskUserQuestion({
	questions,
	answered,
	onSubmit,
}: {
	questions: Question[];
	answered: boolean;
	onSubmit: (reply: string) => void;
}) {
	const [picks, setPicks] = useState<Record<number, Set<number>>>({});
	const [custom, setCustom] = useState<Record<number, string>>({});
	const [step, setStep] = useState(0);

	if (questions.length === 0) return null;

	if (answered) {
		return (
			<div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
				<Check className="size-3.5 shrink-0 text-emerald-500" />
				Answered
			</div>
		);
	}

	const total = questions.length;
	const q = questions[step];
	const isLast = step === total - 1;

	const choose = (oi: number, multi: boolean) => {
		setCustom((c) => ({ ...c, [step]: "" }));
		setPicks((prev) => {
			const next = new Set(multi ? (prev[step] ?? []) : []);
			if (next.has(oi)) next.delete(oi);
			else next.add(oi);
			return { ...prev, [step]: next };
		});
	};

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-muted/20 p-3.5">
			{total > 1 ? (
				<div className="flex items-center justify-between">
					<span className="text-[11px] tabular-nums text-muted-foreground">
						Question {step + 1} of {total}
					</span>
					<div className="flex gap-1">
						{questions.map((qq, i) => (
							<span
								key={`${qq.question}-${i}`}
								className={cn(
									"size-1.5 rounded-full transition-colors",
									i === step
										? "bg-foreground"
										: picks[i]?.size || custom[i]?.trim()
											? "bg-foreground/40"
											: "bg-border",
								)}
							/>
						))}
					</div>
				</div>
			) : null}

			<div className="flex flex-col gap-2.5">
				{q.header ? (
					<span className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground/80 uppercase">
						{q.header}
					</span>
				) : null}
				<span className="text-[15px] leading-snug font-semibold text-foreground">
					{q.question}
				</span>
				<div className="mt-0.5 flex flex-col gap-1.5">
					{q.options.map((opt, oi) => {
						const selected = picks[step]?.has(oi) ?? false;
						return (
							<button
								key={`${opt.label}-${oi}`}
								type="button"
								onClick={() => choose(oi, q.multiSelect ?? false)}
								className={cn(
									"flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
									selected
										? "border-emerald-500/40 bg-emerald-500/10"
										: "border-transparent bg-muted/40 hover:bg-muted/70",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
										selected
											? "border-emerald-500 bg-emerald-500 text-white"
											: "border-border",
									)}
								>
									{selected ? <Check className="size-3" /> : null}
								</span>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="text-[13px] font-medium">{opt.label}</span>
									{opt.description ? (
										<span className="text-[11px] leading-relaxed text-muted-foreground">
											{opt.description}
										</span>
									) : null}
								</span>
							</button>
						);
					})}
				</div>
				<Input
					value={custom[step] ?? ""}
					onChange={(e) => {
						const value = e.target.value;
						setCustom((c) => ({ ...c, [step]: value }));
						setPicks((p) => ({ ...p, [step]: new Set() }));
					}}
					placeholder="Or type your own answer…"
					className="mt-1 h-9 border-transparent bg-muted/40 text-[13px] md:text-[13px] placeholder:text-muted-foreground/60 hover:bg-muted/60 focus-visible:border-border/60 focus-visible:bg-muted/60 focus-visible:ring-0"
				/>
			</div>

			<div className="flex items-center justify-between">
				<Button
					variant="ghost"
					size="sm"
					disabled={step === 0}
					onClick={() => setStep((s) => s - 1)}
					className="gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-0"
				>
					<ArrowLeft className="size-3.5" />
					Back
				</Button>
				{isLast ? (
					<Button
						size="sm"
						onClick={() => onSubmit(formatReply(questions, picks, custom))}
						className="bg-foreground text-background hover:bg-foreground/90"
					>
						Answer
					</Button>
				) : (
					<Button
						size="sm"
						onClick={() => setStep((s) => s + 1)}
						className="gap-1.5 bg-foreground text-background hover:bg-foreground/90"
					>
						Next
						<ArrowRight className="size-3.5" />
					</Button>
				)}
			</div>
		</div>
	);
}
