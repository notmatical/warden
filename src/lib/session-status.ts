import type { Session, SessionStatus } from "@/types"

/** Status as the UI should present it. A session blocked on the user reads as
 *  "needsInput" and takes priority over its raw status, since "waiting on you"
 *  is orthogonal to running/idle: OpenCode and Codex wait while their turn is
 *  still `running`, Claude waits while it has settled to `idle`. */
export type EffectiveStatus = SessionStatus | "needsInput"

export function effectiveStatus(
  session: Pick<Session, "status" | "awaitingInput">
): EffectiveStatus {
  return session.awaitingInput ? "needsInput" : session.status
}
