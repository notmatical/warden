import { useEffect, useRef } from "react"

import { subscribeUiCommand, type CommandId } from "@/lib/commands"

/** Handle a targeted UI command. The handler is held in a ref, so subscribing
 *  never re-runs and the component doesn't re-render unless its handler acts. */
export function useUiCommand<T = void>(
  id: CommandId,
  handler: (payload: T) => void
) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => subscribeUiCommand<T>(id, (payload) => ref.current(payload)), [id])
}
