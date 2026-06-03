import { Kbd } from "@/components/ui/kbd";
import { comboLabel, type KeyCombo } from "@/lib/keybindings";

/** Renders a key combo as a single platform-aware `Kbd`, e.g. CMD+E / CTRL+E. */
export function Shortcut({ combo }: { combo: KeyCombo }) {
	return <Kbd>{comboLabel(combo)}</Kbd>;
}
