import { useState } from "react"

/**
 * Open-state for a popover/menu that is either self-managed or driven by a
 * parent. When `controlled`/`onChange` are provided the parent owns the state
 * (e.g. to make sibling menus mutually exclusive); otherwise it's internal.
 */
export function useControllableOpen(
  controlled?: boolean,
  onChange?: (open: boolean) => void
): [boolean, (open: boolean) => void] {
  const [internal, setInternal] = useState(false)
  return [controlled ?? internal, onChange ?? setInternal]
}
