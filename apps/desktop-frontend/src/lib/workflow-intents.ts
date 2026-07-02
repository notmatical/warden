import {
  Code2,
  ListChecks,
  type LucideIcon,
  ScanSearch,
  ShieldQuestion,
  Sparkles,
  Wand2,
} from "lucide-react"

import type { Intent } from "@/types/workflow"

export interface IntentMeta {
  label: string
  icon: LucideIcon
  /** Tailwind text color for the icon. */
  accent: string
  /** Tailwind bg tint for the icon tile (the node's one spot of color). */
  tile: string
  description: string
  writesCode: boolean
  /** Label for the node's text field. */
  promptLabel: string
  promptPlaceholder: string
  /** Whether the text field is the primary task (vs optional extra). */
  promptRequired: boolean
}

export const INTENT_META: Record<Intent, IntentMeta> = {
  plan: {
    label: "Plan",
    icon: ListChecks,
    accent: "text-violet-500",
    tile: "bg-violet-500/12",
    description: "Research & produce an implementation plan",
    writesCode: false,
    promptLabel: "Feature to plan",
    promptPlaceholder: "Describe the feature or change to plan…",
    promptRequired: true,
  },
  code: {
    label: "Code",
    icon: Code2,
    accent: "text-blue-500",
    tile: "bg-blue-500/12",
    description: "Implement the upstream plan",
    writesCode: true,
    promptLabel: "Extra instructions (optional)",
    promptPlaceholder: "Anything beyond the plan…",
    promptRequired: false,
  },
  review: {
    label: "Review",
    icon: ScanSearch,
    accent: "text-amber-500",
    tile: "bg-amber-500/12",
    description: "Review the code diff & report issues",
    writesCode: false,
    promptLabel: "Extra instructions (optional)",
    promptPlaceholder: "Focus areas for the review…",
    promptRequired: false,
  },
  revise: {
    label: "Revise",
    icon: Wand2,
    accent: "text-emerald-500",
    tile: "bg-emerald-500/12",
    description: "Apply the upstream review's feedback",
    writesCode: true,
    promptLabel: "Extra instructions (optional)",
    promptPlaceholder: "Anything beyond the review…",
    promptRequired: false,
  },
  custom: {
    label: "Custom",
    icon: Sparkles,
    accent: "text-muted-foreground",
    tile: "bg-muted",
    description: "Free-form agent task",
    writesCode: true,
    promptLabel: "Task",
    promptPlaceholder: "What should this agent do?",
    promptRequired: true,
  },
}

export const INTENT_ORDER: Intent[] = [
  "plan",
  "code",
  "review",
  "revise",
  "custom",
]

/** The user-approval gate isn't an agent intent, but it shares the node visual
 *  language, so it carries the same shape of metadata. */
export const GATE_META = {
  label: "User Approval",
  icon: ShieldQuestion,
  accent: "text-amber-500",
  tile: "bg-amber-500/12",
  description: "Sign off before the next agent runs",
} as const
