import { useEffect, useRef } from "react";

import * as terminals from "@/lib/terminal-instances";

/** Hosts a persistent xterm instance for a terminal session: attaches it on
 *  mount, refits on container resize, and detaches (without disposing) on
 *  unmount so the scrollback and shell survive tab switches. */
export function TerminalView({
	sessionId,
	workingDir,
	command,
}: {
	sessionId: string;
	workingDir: string;
	/** Provider CLI to launch instead of the shell, for native sessions. */
	command?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		terminals.attach(sessionId, container, workingDir, command);

		// Coalesce resize bursts to one fit per frame. Without this, fit() mutates
		// the observed element's size and re-triggers the observer in a tight loop.
		let frame = 0;
		const observer = new ResizeObserver(() => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				terminals.fit(sessionId);
			});
		});
		observer.observe(container);

		return () => {
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			terminals.detach(sessionId);
		};
	}, [sessionId, workingDir]);

	return (
		<div ref={containerRef} className="h-full w-full overflow-hidden p-2" />
	);
}
