import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { comboParts, type KeyCombo } from "@/lib/keybindings"

/** Renders a key combo as platform-aware `Kbd` chips. */
export function Shortcut({ combo }: { combo: KeyCombo }) {
  return (
    <KbdGroup>
      {comboParts(combo).map((part, i) => (
        <Kbd key={`${part}-${i}`}>{part}</Kbd>
      ))}
    </KbdGroup>
  )
}
