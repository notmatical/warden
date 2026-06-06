import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, X } from "lucide-react";

import type { Attachment } from "@/types";

/** The wrapped row of pending attachments shown above the composer input —
 *  image thumbnails and file chips, each removable on hover. */
export function AttachmentRow({
	items,
	onRemove,
}: {
	items: Attachment[];
	onRemove: (id: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-wrap gap-2 px-2 pt-2">
			{items.map((att) => (
				<div key={att.id} className="group relative">
					{att.isImage ? (
						<img
							src={convertFileSrc(att.path)}
							alt={att.name}
							className="size-14 rounded-lg border border-border/60 object-cover"
						/>
					) : (
						<div className="flex h-14 w-40 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5">
							<FileText className="size-4 shrink-0 text-muted-foreground" />
							<span
								className="min-w-0 flex-1 truncate text-[12px] text-foreground"
								title={att.path}
							>
								{att.name}
							</span>
						</div>
					)}
					<button
						type="button"
						onClick={() => onRemove(att.id)}
						aria-label={`Remove ${att.name}`}
						className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow-sm transition group-hover:opacity-100"
					>
						<X className="size-2.5" />
					</button>
				</div>
			))}
		</div>
	);
}
