/** Compact number with a k/M suffix, up to 2 decimals, trailing zeros trimmed:
 *  1000 → "1k", 1500 → "1.5k", 1250 → "1.25k", 100000 → "100k", 1e6 → "1M". */
export function formatCompact(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (Math.abs(value) < 1000) return String(Math.round(value));
	const [n, suffix] = value >= 1e6 ? [value / 1e6, "M"] : [value / 1e3, "k"];
	return `${n.toFixed(2).replace(/\.?0+$/, "")}${suffix}`;
}
