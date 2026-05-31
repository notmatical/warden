import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react"

import {
  isEditableTarget,
  matchCombo,
  serializeCombo,
  type Keybinding,
  type KeyCombo,
  type KeyHandler,
} from "@/lib/keybindings"

type RegisterFn = (binding: Keybinding) => () => void

const KeybindingContext = createContext<RegisterFn | null>(null)

/**
 * Installs a single global key listener and dispatches to registered bindings.
 * The first matching binding wins; bindings are skipped while a text field is
 * focused unless they opt in via `allowInInput`.
 */
export function KeybindingProvider({ children }: { children: ReactNode }) {
  const bindings = useRef(new Map<string, Keybinding>())

  const register = useCallback<RegisterFn>((binding) => {
    bindings.current.set(binding.id, binding)
    return () => {
      // Guard against clobbering a newer registration under the same id.
      if (bindings.current.get(binding.id) === binding) {
        bindings.current.delete(binding.id)
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target)
      for (const binding of bindings.current.values()) {
        if (!binding.allowInInput && editable) continue
        if (!matchCombo(binding.combo, event)) continue
        event.preventDefault()
        binding.handler(event)
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <KeybindingContext.Provider value={register}>
      {children}
    </KeybindingContext.Provider>
  )
}

export interface UseKeybindingOptions {
  id: string
  combo: KeyCombo
  handler: KeyHandler
  allowInInput?: boolean
  description?: string
  /** Register only while true — lets callers scope a binding to UI state. */
  enabled?: boolean
}

/** Register a keybinding for the lifetime of the calling component. The handler
 *  may change every render without re-registering. */
export function useKeybinding({
  id,
  combo,
  handler,
  allowInInput = false,
  description,
  enabled = true,
}: UseKeybindingOptions) {
  const register = useContext(KeybindingContext)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const comboSig = serializeCombo(combo)

  useEffect(() => {
    if (!register || !enabled) return
    return register({
      id,
      combo,
      allowInInput,
      description,
      handler: (event) => handlerRef.current(event),
    })
    // `combo` is captured via its stable signature `comboSig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, id, comboSig, allowInInput, description, enabled])
}
