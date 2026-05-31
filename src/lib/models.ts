export interface ModelOption {
  id: string
  label: string
}

export const MODELS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
]

export const DEFAULT_CHAT_MODEL = "claude-opus-4-8"
export const DEFAULT_PLANNER_MODEL = "sonnet"
export const DEFAULT_CODER_MODEL = "claude-opus-4-8"

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id
}
