import type { EventRecord } from "@/types"

/** Tools lifted out of the activity accordion into their own interactive widget
 *  (a question prompt, a plan-approval card) rather than rendered as raw calls. */
export const SPECIAL_TOOLS = new Set<string>([
  "AskUserQuestion",
  "ExitPlanMode",
])

export function isSpecialTool(name: string): boolean {
  return SPECIAL_TOOLS.has(name)
}

/** The tool the agent calls to present its plan and request approval to build. */
export function isPlanTool(name: string): boolean {
  return name === "ExitPlanMode"
}

/** Pull the plan markdown from an `ExitPlanMode` call's input, tolerating the
 *  field-name variations across providers/versions. */
export function resolvePlanContent(input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    for (const key of ["plan", "plan_preview", "explanation", "content"]) {
      const value = obj[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return "The agent is ready to start implementing."
}

/** Subagent container tools (the Claude CLI uses both names). Their child tool
 *  calls carry a `parent_tool_use_id` pointing back at one of these. */
export function isAgentTool(name: string): boolean {
  return name === "Task" || name === "Agent"
}

/** Whether the session is blocked on an unanswered AskUserQuestion. The agent
 *  sometimes keeps narrating after asking, so the session status stays "running"
 *  even though it is really waiting on the user. Callers gate the live "working"
 *  spinner on this. Scans newest-first: a later user message means it was
 *  answered. */
export function hasPendingQuestion(events: EventRecord[] | undefined): boolean {
  if (!events) return false
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === "user_message") return false
    if (e.type === "tool_use" && e.name === "AskUserQuestion") return true
  }
  return false
}
