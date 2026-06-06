import { convertFileSrc } from "@tauri-apps/api/core";
import {
	File,
	FileArchive,
	FileCode,
	FileSpreadsheet,
	FileText,
	Folder,
	X,
} from "lucide-react";
import type { ComponentType } from "react";

import type { Attachment } from "@/types";

const EXT_ICON: Record<string, ComponentType<{ className?: string }>> = {
	zip: FileArchive,
	rar: FileArchive,
	"7z": FileArchive,
	tar: FileArchive,
	gz: FileArchive,
	tgz: FileArchive,
	js: FileCode,
	jsx: FileCode,
	ts: FileCode,
	tsx: FileCode,
	py: FileCode,
	rs: FileCode,
	go: FileCode,
	java: FileCode,
	c: FileCode,
	cpp: FileCode,
	h: FileCode,
	rb: FileCode,
	php: FileCode,
	sh: FileCode,
	json: FileCode,
	html: FileCode,
	css: FileCode,
	vue: FileCode,
	svelte: FileCode,
	md: FileText,
	txt: FileText,
	pdf: FileText,
	doc: FileText,
	docx: FileText,
	rtf: FileText,
	csv: FileSpreadsheet,
	xls: FileSpreadsheet,
	xlsx: FileSpreadsheet,
};

/** Icon + short type label for a non-image attachment. */
function fileMeta(att: Attachment): {
	Icon: ComponentType<{ className?: string }>;
	label: string;
} {
	if (att.isDir) {
		return { Icon: Folder, label: "" };
	}
	const ext = att.name.includes(".")
		? (att.name.split(".").pop() ?? "").toLowerCase()
		: "";
	return { Icon: EXT_ICON[ext] ?? File, label: ext.toUpperCase() };
}

/** The wrapped row of pending attachments above the composer input — uniform
 *  square tiles: an image thumbnail, or a type icon for files/folders. */
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
			{items.map((att) => {
				const { Icon, label } = fileMeta(att);
				return (
					<div key={att.id} className="group relative" title={att.name}>
						{att.isImage ? (
							<img
								src={convertFileSrc(att.path)}
								alt={att.name}
								className="size-14 rounded-lg border border-border/60 object-cover"
							/>
						) : (
							<div className="flex size-14 flex-col items-center justify-center gap-1 rounded-lg border border-border/60 bg-muted/40">
								<Icon className="size-6 text-muted-foreground" />
								{label ? (
									<span className="text-[9px] leading-none font-medium tracking-wide text-muted-foreground/80">
										{label}
									</span>
								) : null}
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
				);
			})}
		</div>
	);
}
