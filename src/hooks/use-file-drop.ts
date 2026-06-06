import { getCurrentWebview } from "@tauri-apps/api/webview";
import { type RefObject, useEffect, useRef, useState } from "react";

/** Registers Tauri's window file-drop listener and reports drops that land over
 *  `ref`'s element. Tauri delivers OS drops at the window level (HTML5 drop
 *  can't see file paths while `dragDropEnabled` is on), so we hit-test the
 *  physical drop position against the element's rect. Returns whether a drag is
 *  currently hovering the element (for a drop-target highlight). */
export function useFileDrop(
	ref: RefObject<HTMLElement | null>,
	onDrop: (paths: string[]) => void,
): boolean {
	const [isOver, setIsOver] = useState(false);
	const onDropRef = useRef(onDrop);
	useEffect(() => {
		onDropRef.current = onDrop;
	});

	useEffect(() => {
		const contains = (x: number, y: number) => {
			const el = ref.current;
			if (!el) return false;
			const rect = el.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const cssX = x / dpr;
			const cssY = y / dpr;
			return (
				cssX >= rect.left &&
				cssX <= rect.right &&
				cssY >= rect.top &&
				cssY <= rect.bottom
			);
		};

		const unlisten = getCurrentWebview().onDragDropEvent((event) => {
			const payload = event.payload;
			if (payload.type === "enter" || payload.type === "over") {
				setIsOver(contains(payload.position.x, payload.position.y));
			} else if (payload.type === "drop") {
				const inside = contains(payload.position.x, payload.position.y);
				setIsOver(false);
				if (inside && payload.paths.length > 0) {
					onDropRef.current(payload.paths);
				}
			} else {
				setIsOver(false);
			}
		});
		return () => void unlisten.then((off) => off());
	}, [ref]);

	return isOver;
}
