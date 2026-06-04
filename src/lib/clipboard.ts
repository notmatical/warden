import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

/** Copy text to the system clipboard via the native clipboard. Returns whether
 *  it succeeded. Shows a confirmation toast unless `confirmation` is empty (e.g.
 *  when the caller has its own inline feedback). */
export async function copyText(
	text: string,
	confirmation = "Copied",
): Promise<boolean> {
	try {
		await writeText(text);
		if (confirmation) toast.success(confirmation);
		return true;
	} catch (error) {
		toast.error("Failed to copy", {
			description: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/** Read the system clipboard, or `null` if unavailable. */
export async function readClipboard(): Promise<string | null> {
	try {
		return await readText();
	} catch {
		return null;
	}
}
