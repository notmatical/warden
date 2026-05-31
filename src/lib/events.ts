import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { DeltaPayload, EventRecord, Session } from "@/types"

export function onAgentEvent(
  handler: (record: EventRecord) => void
): Promise<UnlistenFn> {
  return listen<EventRecord>("agent-event", (event) => handler(event.payload))
}

export function onAgentDelta(
  handler: (payload: DeltaPayload) => void
): Promise<UnlistenFn> {
  return listen<DeltaPayload>("agent-delta", (event) => handler(event.payload))
}

export function onSessionUpdated(
  handler: (session: Session) => void
): Promise<UnlistenFn> {
  return listen<Session>("session-updated", (event) => handler(event.payload))
}
