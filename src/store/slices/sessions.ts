import type { StateCreator } from "zustand";

import * as ipc from "@/lib/ipc";
import {
	backendForModel,
	DEFAULT_CHAT_MODEL,
	DEFAULT_CODEX_MODEL,
} from "@/lib/models";
import { notify, windowFocused } from "@/lib/notify";
import { detachSession, firstLeaf } from "@/lib/pane-tree";
import * as terminals from "@/lib/terminal-instances";
import { NATIVE_CLI, NATIVE_TITLE, reportError, showSession } from "../shared";
import type { AppState } from "../types";

type SessionsSlice = Pick<
	AppState,
	| "sessions"
	| "createSession"
	| "createNativeSession"
	| "updateSession"
	| "setIsolation"
	| "renameSession"
	| "deleteSessions"
	| "deleteSession"
	| "onSessionUpdated"
>;

/** Session lifecycle: create (agent + native terminal), live settings, rename,
 *  delete, and reconciling backend session-updated events. */
export const createSessionsSlice: StateCreator<
	AppState,
	[],
	[],
	SessionsSlice
> = (set, get) => ({
	sessions: {},

	createSession: async (opts) => {
		if (!opts.projectId) {
			reportError("No folder selected", "Add a folder to this group first.");
			return null;
		}
		// The session belongs to the group that owns its root — not whatever group
		// was last focused. Fall back to the active group only if the root isn't
		// found (shouldn't happen).
		const groupId =
			Object.entries(get().rootsByGroup).find(([, roots]) =>
				roots.some((root) => root.id === opts.projectId),
			)?.[0] ?? get().activeGroupId;
		if (!groupId) {
			reportError("No group selected", "Create a group first.");
			return null;
		}
		try {
			const session = await ipc.createSession({
				projectId: opts.projectId,
				groupId,
				title: opts.title,
				model: opts.model,
				permissionMode: opts.permissionMode,
				effort: opts.effort,
				role: opts.role,
				kind: opts.kind,
				backend: opts.backend,
				isolate: opts.isolate,
				nativeCommand: opts.nativeCommand,
			});
			set((state) => ({
				sessions: { ...state.sessions, [session.id]: session },
				sessionsByGroup: {
					...state.sessionsByGroup,
					[groupId]: [...(state.sessionsByGroup[groupId] ?? []), session.id],
				},
				openTabs: [...state.openTabs, session.id],
				activeSessionId: session.id,
				// Show the new session in the focused pane (a fresh viewport places it
				// in the lone empty leaf).
				layout: showSession(state.layout, state.activeSessionId, session.id),
				eventsBySession: { ...state.eventsBySession, [session.id]: [] },
			}));
			get().saveView();
			if (
				opts.kind !== "terminal" &&
				opts.firstMessage &&
				opts.firstMessage.trim()
			) {
				await get().sendMessage(session.id, opts.firstMessage.trim());
			}
			return session;
		} catch (error) {
			reportError("Failed to create session", error);
			return null;
		}
	},

	createNativeSession: async (projectId, provider) => {
		await get().createSession({
			projectId,
			title: NATIVE_TITLE[provider],
			model: provider === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CHAT_MODEL,
			permissionMode: "bypassPermissions",
			role: "chat",
			kind: "terminal",
			backend: provider,
			nativeCommand: NATIVE_CLI[provider],
		});
	},

	updateSession: async (sessionId, patch) => {
		const current = get().sessions[sessionId];
		if (!current) return;
		// A model change re-homes the session to that model's backend (gpt → codex);
		// reflect it optimistically so the provider icon/menu update instantly.
		const backend = patch.model
			? backendForModel(patch.model)
			: current.backend;
		// Optimistically apply so the controls feel instant; the backend emits the
		// authoritative session-updated event which reconciles.
		set((state) => ({
			sessions: {
				...state.sessions,
				[sessionId]: { ...current, ...patch, backend },
			},
		}));
		try {
			await ipc.updateSession(sessionId, patch);
		} catch (error) {
			set((state) => ({
				sessions: { ...state.sessions, [sessionId]: current },
			}));
			reportError("Failed to update session", error);
		}
	},

	setIsolation: async (sessionId, isolate) => {
		try {
			// The backend re-provisions and emits the authoritative session-updated.
			await ipc.setSessionIsolation(sessionId, isolate);
		} catch (error) {
			reportError("Failed to change isolation", error);
		}
	},

	renameSession: async (sessionId, title) => {
		const trimmed = title.trim();
		const current = get().sessions[sessionId];
		if (!current || !trimmed || trimmed === current.title) return;
		set((state) => ({
			sessions: {
				...state.sessions,
				[sessionId]: { ...current, title: trimmed },
			},
		}));
		try {
			await ipc.renameSession(sessionId, trimmed);
		} catch (error) {
			set((state) => ({
				sessions: { ...state.sessions, [sessionId]: current },
			}));
			reportError("Failed to rename session", error);
		}
	},

	deleteSessions: async (sessionIds) => {
		const deleted = new Set<string>();
		for (const id of sessionIds) {
			try {
				if (get().sessions[id]?.kind === "terminal") {
					terminals.dispose(id);
				}
				await ipc.deleteSession(id);
				deleted.add(id);
			} catch (error) {
				reportError("Failed to delete session", error);
			}
		}
		if (deleted.size === 0) return;

		set((state) => {
			const omit = <T>(record: Record<string, T>): Record<string, T> =>
				Object.fromEntries(
					Object.entries(record).filter(([sid]) => !deleted.has(sid)),
				);

			const sessionsByGroup = Object.fromEntries(
				Object.entries(state.sessionsByGroup).map(([gid, ids]) => [
					gid,
					ids.filter((id) => !deleted.has(id)),
				]),
			);

			const prevTabs = state.openTabs;
			const openTabs = prevTabs.filter((sid) => !deleted.has(sid));

			let layout = state.layout;
			for (const sid of deleted) layout = detachSession(layout, sid);

			let activeSessionId = state.activeSessionId;
			if (activeSessionId && deleted.has(activeSessionId)) {
				const idx = prevTabs.indexOf(activeSessionId);
				const surviving = (start: number, step: number) => {
					for (let i = start; i >= 0 && i < prevTabs.length; i += step) {
						const sid = prevTabs[i];
						if (!deleted.has(sid)) return sid;
					}
					return null;
				};
				// Prefer a still-visible pane; else the nearest surviving tab.
				activeSessionId =
					firstLeaf(layout).sessionId ??
					surviving(idx + 1, 1) ??
					surviving(idx - 1, -1);
				if (activeSessionId) {
					layout = showSession(layout, activeSessionId, activeSessionId);
				}
			}

			return {
				sessions: omit(state.sessions),
				sessionsByGroup,
				openTabs,
				activeSessionId,
				layout,
				eventsBySession: omit(state.eventsBySession),
				approvalResolvedBySession: omit(state.approvalResolvedBySession),
				streamingBySession: omit(state.streamingBySession),
				startedAtBySession: omit(state.startedAtBySession),
				loadingEventsBySession: omit(state.loadingEventsBySession),
			};
		});

		get().saveView();
	},

	deleteSession: (sessionId) => get().deleteSessions([sessionId]),

	onSessionUpdated: (session) => {
		const finishedTurn =
			get().sessions[session.id]?.status === "running" &&
			session.status !== "running";
		set((state) => {
			const wasRunning = state.sessions[session.id]?.status === "running";
			const isRunning = session.status === "running";
			let startedAtBySession = state.startedAtBySession;
			if (isRunning && !wasRunning) {
				startedAtBySession = {
					...startedAtBySession,
					[session.id]: Date.now(),
				};
			} else if (!isRunning && wasRunning) {
				startedAtBySession = { ...startedAtBySession };
				delete startedAtBySession[session.id];
			}
			return {
				sessions: { ...state.sessions, [session.id]: session },
				startedAtBySession,
			};
		});
		// Nudge with a native notification when a turn finishes while you're away.
		if (finishedTurn && !windowFocused()) {
			const errored = session.status === "error";
			void notify(
				errored ? `${session.title} stopped` : `${session.title} finished`,
				errored
					? "The agent stopped on an error."
					: "The agent is ready for your next message.",
			);
		}
	},
});
