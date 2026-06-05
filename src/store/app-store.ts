import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { onAgentDelta, onAgentEvent, onSessionUpdated } from "@/lib/events";
import * as ipc from "@/lib/ipc";
import {
	backendForModel,
	DEFAULT_CHAT_MODEL,
	DEFAULT_CODEX_MODEL,
} from "@/lib/models";
import { notify, windowFocused } from "@/lib/notify";
import {
	detachSession,
	emptyTree,
	findSessionLeaf,
	firstLeaf,
	leaves,
	makeLeaf,
	setLeafSession,
	splitLeaf,
} from "@/lib/pane-tree";
import * as terminals from "@/lib/terminal-instances";
import { readView, writeView } from "@/lib/view";
import type {
	Backend,
	DeltaPayload,
	EffortLevel,
	EventRecord,
	Group,
	IntegrateOutcome,
	MergeMode,
	PaneTree,
	PermissionMode,
	PrInfo,
	Project,
	Provider,
	ProviderSource,
	ProviderStatus,
	Session,
	SessionKind,
	SessionRole,
	SyncOutcome,
} from "@/types";

function reportError(scope: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	toast.error(scope, { description: message });
}

/** Make `sessionId` visible and focused: if it's already in a pane, leave the
 *  tree as-is (the caller focuses it); otherwise drop it into the focused pane
 *  (the leaf showing `currentActive`, else the first leaf). */
function showSession(
	tree: PaneTree,
	currentActive: string | null,
	sessionId: string,
): PaneTree {
	if (findSessionLeaf(tree, sessionId)) return tree;
	const focused =
		(currentActive ? findSessionLeaf(tree, currentActive) : undefined) ??
		firstLeaf(tree);
	return setLeafSession(tree, focused.id, sessionId);
}

/** The interactive CLI a native terminal session launches, per provider. */
const NATIVE_CLI: Record<Provider, string> = {
	claude: "claude",
	codex: "codex",
};

const NATIVE_TITLE: Record<Provider, string> = {
	claude: "Claude",
	codex: "Codex",
};

const SIDEBAR_KEY = "warden:sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "warden:sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 420;

function readSidebarCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_KEY) === "1";
	} catch {
		return false;
	}
}

function clampWidth(px: number): number {
	return Math.max(
		MIN_SIDEBAR_WIDTH,
		Math.min(MAX_SIDEBAR_WIDTH, Math.round(px)),
	);
}

function readSidebarWidth(): number {
	try {
		const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
		return Number.isFinite(stored) && stored > 0
			? clampWidth(stored)
			: DEFAULT_SIDEBAR_WIDTH;
	} catch {
		return DEFAULT_SIDEBAR_WIDTH;
	}
}

export interface CreateSessionOptions {
	projectId: string;
	title: string;
	model: string;
	permissionMode: PermissionMode;
	effort?: EffortLevel;
	role?: SessionRole;
	kind?: SessionKind;
	backend?: Backend;
	isolate?: boolean;
	firstMessage?: string;
	/** A provider CLI for a native terminal session to launch instead of the shell. */
	nativeCommand?: string;
}

export interface SessionSettingsPatch {
	model?: string;
	permissionMode?: PermissionMode;
	effort?: EffortLevel;
}

export interface RunPlanToCodeOptions {
	task: string;
	plannerModel: string;
	coderModel: string;
}

interface AppState {
	groups: Group[];
	activeGroupId: string | null;
	/** A group's repo roots, ordered. */
	rootsByGroup: Record<string, Project[]>;
	/** All session ids in a group (for the sidebar tree, not just open tabs). */
	sessionsByGroup: Record<string, string[]>;
	/** Open tabs across every group, in order — the viewport is global. */
	openTabs: string[];
	/** The focused tab (must be in `openTabs`), or null. */
	activeSessionId: string | null;
	/** The global pane arrangement (recursive split-tree). */
	layout: PaneTree;
	/** Session id currently being dragged (drives drop zones + the drag clone). */
	draggingSessionId: string | null;
	sessions: Record<string, Session>;
	/** Install/auth status of each agent CLI provider. */
	providers: ProviderStatus[];
	/** Install/auth status of the GitHub CLI (loaded lazily by Settings). */
	githubStatus: ProviderStatus | null;
	eventsBySession: Record<string, EventRecord[]>;
	/** permission_request event id the user has acted on, per session — so the
	 *  approval bar dismisses on approve/deny. */
	approvalResolvedBySession: Record<string, string>;
	streamingBySession: Record<string, string>;
	/** Wall-clock start of the in-flight turn, for the live elapsed timer. */
	startedAtBySession: Record<string, number>;

	sidebarCollapsed: boolean;
	sidebarWidth: number;

	/** Settings dialog visibility and the section it opens to. */
	settingsOpen: boolean;
	settingsSection: string;

	initialized: boolean;
	loadingGroups: boolean;
	loadingEventsBySession: Record<string, boolean>;

	init: () => Promise<void>;
	/** Restore the persisted global view once all groups are loaded. */
	restoreView: () => void;
	setSidebarCollapsed: (collapsed: boolean) => void;
	setSidebarWidth: (width: number) => void;
	loadProviders: () => Promise<void>;
	installProvider: (id: Provider) => Promise<void>;
	updateProvider: (id: Provider) => Promise<void>;
	setProviderSource: (id: Provider, source: ProviderSource) => Promise<void>;
	loadGithubStatus: () => Promise<void>;
	installGithub: () => Promise<void>;
	updateGithub: () => Promise<void>;
	setGithubSource: (source: ProviderSource) => Promise<void>;
	openSettings: (section?: string) => void;
	setSettingsOpen: (open: boolean) => void;
	integrateSession: (
		sessionId: string,
		message: string,
		mode: MergeMode,
	) => Promise<IntegrateOutcome | null>;
	openPullRequest: (
		sessionId: string,
		title: string,
		body: string,
		draft?: boolean,
	) => Promise<PrInfo | null>;
	refreshPrStatus: (sessionId: string) => Promise<PrInfo | null>;
	mergePullRequest: (
		sessionId: string,
		strategy: MergeMode,
	) => Promise<boolean>;
	syncWorktree: (
		sessionId: string,
		mode?: MergeMode,
	) => Promise<SyncOutcome | null>;
	checkoutPr: (projectId: string, number: number) => Promise<Session | null>;
	loadGroupData: (groupId: string) => Promise<void>;
	createGroup: (name: string) => Promise<Group | null>;
	selectGroup: (id: string) => Promise<void>;
	renameGroup: (id: string, name: string) => Promise<void>;
	deleteGroup: (id: string) => Promise<void>;
	addRoot: (groupId: string) => Promise<void>;
	removeRoot: (groupId: string, projectId: string) => Promise<void>;
	setLayout: (layout: PaneTree) => void;
	/** Drop a session into a pane (by leaf id), opening + focusing it. */
	assignToPane: (leafId: string, sessionId: string) => void;
	/** Split a pane (by leaf id) on one edge, placing the session in the new half. */
	splitPane: (
		leafId: string,
		side: "left" | "right" | "top" | "bottom",
		sessionId: string,
	) => void;
	setDragging: (sessionId: string | null) => void;
	/** Move an open tab to just before another in the strip. */
	reorderTab: (draggedId: string, targetId: string) => void;
	/** Persist the global view-state (layout + open tabs + active tab). */
	saveView: () => void;
	createSession: (opts: CreateSessionOptions) => Promise<Session | null>;
	/** Create a terminal session that launches a provider's CLI natively. */
	createNativeSession: (projectId: string, provider: Provider) => Promise<void>;
	openSession: (id: string) => void;
	updateSession: (
		sessionId: string,
		patch: SessionSettingsPatch,
	) => Promise<void>;
	setIsolation: (sessionId: string, isolate: boolean) => Promise<void>;
	renameSession: (sessionId: string, title: string) => Promise<void>;
	deleteSessions: (sessionIds: string[]) => Promise<void>;
	deleteSession: (sessionId: string) => Promise<void>;
	selectSession: (id: string) => void;
	closeTab: (id: string) => void;
	closeOthers: (id: string) => void;
	sendMessage: (sessionId: string, text: string) => Promise<void>;
	cancel: (sessionId: string) => Promise<void>;
	approveTools: (sessionId: string, patterns: string[]) => Promise<void>;
	approvePlan: (sessionId: string) => Promise<void>;
	resolveApproval: (sessionId: string, eventId: string) => void;
	runPlanToCode: (opts: RunPlanToCodeOptions) => Promise<void>;
	loadEvents: (sessionId: string) => Promise<void>;

	onAgentEvent: (record: EventRecord) => void;
	onDelta: (payload: DeltaPayload) => void;
	onSessionUpdated: (session: Session) => void;
}

let listenersWired = false;

export const useAppStore = create<AppState>((set, get) => ({
	groups: [],
	activeGroupId: null,
	rootsByGroup: {},
	sessionsByGroup: {},
	openTabs: [],
	activeSessionId: null,
	layout: emptyTree(),
	draggingSessionId: null,
	sessions: {},
	providers: [],
	githubStatus: null,
	settingsOpen: false,
	settingsSection: "providers",
	eventsBySession: {},
	approvalResolvedBySession: {},
	streamingBySession: {},
	startedAtBySession: {},

	sidebarCollapsed: readSidebarCollapsed(),
	sidebarWidth: readSidebarWidth(),

	initialized: false,
	loadingGroups: false,
	loadingEventsBySession: {},

	init: async () => {
		if (get().initialized) {
			return;
		}
		set({ initialized: true });

		if (!listenersWired) {
			listenersWired = true;
			onAgentEvent((record) => get().onAgentEvent(record));
			onAgentDelta((payload) => get().onDelta(payload));
			onSessionUpdated((session) => get().onSessionUpdated(session));
			// Re-probe providers when the window regains focus, so installs or
			// logins done outside the app are reflected without a restart.
			window.addEventListener("focus", () => void get().loadProviders());
		}

		void get().loadProviders();

		set({ loadingGroups: true });
		try {
			const groups = await ipc.listGroups();
			set({ groups, activeGroupId: groups[0]?.id ?? null });
			// The viewport is global, so every group's sessions must be loaded for a
			// restored tab (from any group) to resolve.
			await Promise.all(groups.map((g) => get().loadGroupData(g.id)));
			get().restoreView();
		} catch (error) {
			reportError("Failed to load groups", error);
		} finally {
			set({ loadingGroups: false });
		}
	},

	// Restore the persisted global view, dropping references to sessions that no
	// longer exist. Called once after all groups load.
	restoreView: () => {
		const saved = readView();
		if (!saved) return;
		const { sessions } = get();
		const exists = (id: string) => sessions[id] !== undefined;
		const openTabs = saved.openTabs.filter(exists);
		// Drop panes pointing at sessions that are gone or no longer open.
		let layout = saved.layout;
		for (const leaf of leaves(layout)) {
			if (leaf.sessionId && !openTabs.includes(leaf.sessionId)) {
				layout = detachSession(layout, leaf.sessionId);
			}
		}
		const activeSessionId =
			saved.activeSessionId && openTabs.includes(saved.activeSessionId)
				? saved.activeSessionId
				: (openTabs[0] ?? null);
		set({ openTabs, activeSessionId, layout });
		if (activeSessionId && !get().eventsBySession[activeSessionId]) {
			void get().loadEvents(activeSessionId);
		}
	},

	setSidebarCollapsed: (collapsed) => {
		try {
			localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
		} catch {
			// ignore storage failures
		}
		set({ sidebarCollapsed: collapsed });
	},

	setSidebarWidth: (width) => {
		const clamped = clampWidth(width);
		try {
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
		} catch {
			// ignore storage failures
		}
		set({ sidebarWidth: clamped });
	},

	loadProviders: async () => {
		try {
			const providers = await ipc.listProviderStatus();
			set({ providers });
		} catch (error) {
			reportError("Failed to load providers", error);
		}
	},

	installProvider: async (id) => {
		const name = get().providers.find((p) => p.id === id)?.name ?? id;
		try {
			await ipc.installProvider(id);
			await get().loadProviders();
			toast.success(`Installed ${name}`);
		} catch (error) {
			reportError(`Failed to install ${name}`, error);
		}
	},

	updateProvider: async (id) => {
		const name = get().providers.find((p) => p.id === id)?.name ?? id;
		try {
			await ipc.updateProvider(id);
			await get().loadProviders();
			toast.success(`Updated ${name}`);
		} catch (error) {
			reportError(`Failed to update ${name}`, error);
		}
	},

	setProviderSource: async (id, source) => {
		// Optimistically reflect the choice; loadProviders reconciles the resolved
		// binary, version, and update availability for the new source.
		set((state) => ({
			providers: state.providers.map((p) =>
				p.id === id ? { ...p, source } : p,
			),
		}));
		try {
			await ipc.setProviderSource(id, source);
			await get().loadProviders();
		} catch (error) {
			reportError("Failed to change CLI source", error);
			await get().loadProviders();
		}
	},

	loadGithubStatus: async () => {
		try {
			set({ githubStatus: await ipc.githubStatus() });
		} catch (error) {
			reportError("Failed to load GitHub CLI status", error);
		}
	},

	installGithub: async () => {
		try {
			await ipc.installGithubCli();
			await get().loadGithubStatus();
			toast.success("Installed GitHub CLI");
		} catch (error) {
			reportError("Failed to install GitHub CLI", error);
		}
	},

	updateGithub: async () => {
		try {
			await ipc.updateGithubCli();
			await get().loadGithubStatus();
			toast.success("Updated GitHub CLI");
		} catch (error) {
			reportError("Failed to update GitHub CLI", error);
		}
	},

	setGithubSource: async (source) => {
		set((state) => ({
			githubStatus: state.githubStatus
				? { ...state.githubStatus, source }
				: state.githubStatus,
		}));
		try {
			await ipc.setGithubSource(source);
			await get().loadGithubStatus();
		} catch (error) {
			reportError("Failed to change CLI source", error);
			await get().loadGithubStatus();
		}
	},

	openSettings: (section = "providers") =>
		set({ settingsOpen: true, settingsSection: section }),
	setSettingsOpen: (open) => set({ settingsOpen: open }),

	integrateSession: async (sessionId, message, mode) => {
		// Success updates the session (mergedAt) via the session-updated event.
		try {
			return await ipc.integrateSession(sessionId, message, mode);
		} catch (error) {
			reportError("Failed to merge session", error);
			return null;
		}
	},

	openPullRequest: async (sessionId, title, body, draft) => {
		// Success records the PR on the session via the session-updated event.
		try {
			return await ipc.openPullRequest(sessionId, title, body, draft);
		} catch (error) {
			reportError("Failed to open pull request", error);
			return null;
		}
	},

	refreshPrStatus: async (sessionId) => {
		try {
			return await ipc.refreshPrStatus(sessionId);
		} catch {
			return null;
		}
	},

	mergePullRequest: async (sessionId, strategy) => {
		// Success marks the session merged via the session-updated event.
		try {
			await ipc.mergePullRequest(sessionId, strategy);
			return true;
		} catch (error) {
			reportError("Failed to merge pull request", error);
			return false;
		}
	},

	syncWorktree: async (sessionId, mode) => {
		try {
			return await ipc.syncWorktree(sessionId, mode);
		} catch (error) {
			reportError("Failed to sync with base", error);
			return null;
		}
	},

	checkoutPr: async (projectId, number) => {
		try {
			const session = await ipc.checkoutPr(
				projectId,
				number,
				DEFAULT_CHAT_MODEL,
			);
			const groupId = session.groupId;
			set((state) => ({
				sessions: { ...state.sessions, [session.id]: session },
				sessionsByGroup: {
					...state.sessionsByGroup,
					[groupId]: [
						...(state.sessionsByGroup[groupId] ?? []),
						session.id,
					],
				},
				openTabs: state.openTabs.includes(session.id)
					? state.openTabs
					: [...state.openTabs, session.id],
				activeSessionId: session.id,
				layout: showSession(state.layout, state.activeSessionId, session.id),
				eventsBySession: { ...state.eventsBySession, [session.id]: [] },
			}));
			get().saveView();
			if (get().activeGroupId !== groupId) await get().selectGroup(groupId);
			return session;
		} catch (error) {
			reportError("Failed to check out PR", error);
			return null;
		}
	},

	// Loads a group's roots and sessions into the store for the sidebar tree.
	// Purely organizational — the open tabs/layout are global (see restoreView).
	loadGroupData: async (groupId) => {
		try {
			const [roots, sessions] = await Promise.all([
				ipc.listGroupRoots(groupId),
				ipc.listGroupSessions(groupId),
			]);
			set((state) => {
				const nextSessions = { ...state.sessions };
				for (const session of sessions) {
					nextSessions[session.id] = session;
				}
				return {
					sessions: nextSessions,
					rootsByGroup: { ...state.rootsByGroup, [groupId]: roots },
					sessionsByGroup: {
						...state.sessionsByGroup,
						[groupId]: sessions.map((s) => s.id),
					},
				};
			});
		} catch (error) {
			reportError("Failed to load group", error);
		}
	},

	createGroup: async (name) => {
		try {
			const group = await ipc.createGroup(name);
			set((state) => ({
				groups: [...state.groups, group],
				activeGroupId: group.id,
				rootsByGroup: { ...state.rootsByGroup, [group.id]: [] },
				sessionsByGroup: { ...state.sessionsByGroup, [group.id]: [] },
			}));
			return group;
		} catch (error) {
			reportError("Failed to create group", error);
			return null;
		}
	},

	selectGroup: async (id) => {
		if (get().activeGroupId === id) {
			return;
		}
		set({ activeGroupId: id });
		if (!get().rootsByGroup[id]) {
			await get().loadGroupData(id);
		}
	},

	renameGroup: async (id, name) => {
		const trimmed = name.trim();
		const current = get().groups.find((g) => g.id === id);
		if (!current || !trimmed || trimmed === current.name) return;
		set((state) => ({
			groups: state.groups.map((g) =>
				g.id === id ? { ...g, name: trimmed } : g,
			),
		}));
		try {
			await ipc.renameGroup(id, trimmed);
		} catch (error) {
			set((state) => ({
				groups: state.groups.map((g) => (g.id === id ? current : g)),
			}));
			reportError("Failed to rename group", error);
		}
	},

	deleteGroup: async (id) => {
		const { groups, sessionsByGroup, sessions } = get();
		const ownedSessions = sessionsByGroup[id] ?? [];
		for (const sid of ownedSessions) {
			if (sessions[sid]?.kind === "terminal") {
				terminals.dispose(sid);
			}
		}
		const removed = new Set(get().sessionsByGroup[id] ?? []);
		set((state) => {
			const nextGroups = state.groups.filter((g) => g.id !== id);
			let activeGroupId = state.activeGroupId;
			if (activeGroupId === id) {
				activeGroupId = nextGroups[0]?.id ?? null;
			}
			const omit = <T>(record: Record<string, T>): Record<string, T> =>
				Object.fromEntries(
					Object.entries(record).filter(([gid]) => gid !== id),
				);
			// The deleted group's sessions leave the global viewport too.
			const openTabs = state.openTabs.filter((sid) => !removed.has(sid));
			let layout = state.layout;
			for (const sid of removed) layout = detachSession(layout, sid);
			const activeSessionId =
				state.activeSessionId && removed.has(state.activeSessionId)
					? (firstLeaf(layout).sessionId ?? openTabs[0] ?? null)
					: state.activeSessionId;
			return {
				groups: nextGroups,
				activeGroupId,
				rootsByGroup: omit(state.rootsByGroup),
				sessionsByGroup: omit(state.sessionsByGroup),
				openTabs,
				activeSessionId,
				layout,
			};
		});
		get().saveView();
		try {
			await ipc.deleteGroup(id);
		} catch (error) {
			reportError("Failed to delete group", error);
			set({ groups });
		}
	},

	addRoot: async (groupId) => {
		try {
			const selected = await open({ directory: true, multiple: false });
			if (typeof selected !== "string") {
				return;
			}
			const project = await ipc.addGroupRoot(groupId, selected);
			set((state) => {
				const roots = state.rootsByGroup[groupId] ?? [];
				return {
					rootsByGroup: {
						...state.rootsByGroup,
						[groupId]: roots.some((p) => p.id === project.id)
							? roots.map((p) => (p.id === project.id ? project : p))
							: [...roots, project],
					},
				};
			});
		} catch (error) {
			reportError("Failed to add folder", error);
		}
	},

	removeRoot: async (groupId, projectId) => {
		try {
			await ipc.removeGroupRoot(groupId, projectId);
			set((state) => ({
				rootsByGroup: {
					...state.rootsByGroup,
					[groupId]: (state.rootsByGroup[groupId] ?? []).filter(
						(p) => p.id !== projectId,
					),
				},
			}));
		} catch (error) {
			reportError("Failed to remove folder", error);
		}
	},

	setLayout: (layout) => {
		set({ layout });
		get().saveView();
	},

	assignToPane: (leafId, sessionId) => {
		set((state) => {
			const openTabs = state.openTabs.includes(sessionId)
				? state.openTabs
				: [...state.openTabs, sessionId];
			// Move the session out of any pane it already occupies, then into the
			// drop target (replacing whatever it held). If the target collapsed
			// during the move, fall back to the focused pane.
			let layout = detachSession(state.layout, sessionId);
			const exists = leaves(layout).some((l) => l.id === leafId);
			layout = exists
				? setLeafSession(layout, leafId, sessionId)
				: showSession(layout, state.activeSessionId, sessionId);
			return { openTabs, activeSessionId: sessionId, layout };
		});
		get().saveView();
	},

	splitPane: (leafId, side, sessionId) => {
		set((state) => {
			const openTabs = state.openTabs.includes(sessionId)
				? state.openTabs
				: [...state.openTabs, sessionId];
			// Move out of any current pane first so a session never shows twice.
			let layout = detachSession(state.layout, sessionId);
			const exists = leaves(layout).some((l) => l.id === leafId);
			layout = exists
				? splitLeaf(layout, leafId, side, sessionId)
				: showSession(layout, state.activeSessionId, sessionId);
			return { openTabs, activeSessionId: sessionId, layout };
		});
		get().saveView();
	},

	setDragging: (sessionId) => set({ draggingSessionId: sessionId }),

	reorderTab: (draggedId, targetId) => {
		if (draggedId === targetId) return;
		set((state) => {
			const tabs = [...state.openTabs];
			const from = tabs.indexOf(draggedId);
			if (from === -1 || !tabs.includes(targetId)) return {};
			tabs.splice(from, 1);
			tabs.splice(tabs.indexOf(targetId), 0, draggedId);
			return { openTabs: tabs };
		});
		get().saveView();
	},

	saveView: () => {
		const { openTabs, activeSessionId, layout } = get();
		writeView({ openTabs, activeSessionId, layout });
	},

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

	// Open a session into a tab (from the sidebar) and focus it. If it isn't
	// already shown in a pane, it takes over the focused pane.
	openSession: (id) => {
		const session = get().sessions[id];
		if (!session) {
			return;
		}
		set((state) => ({
			// Focus the session's group in the sidebar (new sessions land there).
			activeGroupId: session.groupId,
			openTabs: state.openTabs.includes(id)
				? state.openTabs
				: [...state.openTabs, id],
			activeSessionId: id,
			layout: showSession(state.layout, state.activeSessionId, id),
		}));
		get().saveView();
		if (!get().eventsBySession[id]) {
			void get().loadEvents(id);
		}
	},

	// Focus an open tab. If it's visible in a pane we just focus it; otherwise it
	// swaps into the focused pane.
	selectSession: (id) => {
		if (!get().sessions[id]) {
			return;
		}
		set((state) => ({
			activeSessionId: id,
			layout: showSession(state.layout, state.activeSessionId, id),
		}));
		get().saveView();
		if (!get().eventsBySession[id]) {
			void get().loadEvents(id);
		}
	},

	closeTab: (id) => {
		// Closing a terminal tab kills its PTY (no orphan processes); the session
		// row survives in the sidebar and reopens to a resume prompt.
		if (get().sessions[id]?.kind === "terminal") {
			terminals.dispose(id);
		}
		set((state) => {
			const prevTabs = state.openTabs;
			const openTabs = prevTabs.filter((sid) => sid !== id);
			// Collapse the pane showing the closed session (or clear the sole pane).
			let layout = detachSession(state.layout, id);
			let activeSessionId = state.activeSessionId;
			if (activeSessionId === id) {
				const closedIndex = prevTabs.indexOf(id);
				const nextTab =
					openTabs[closedIndex] ??
					openTabs[closedIndex - 1] ??
					openTabs[0] ??
					null;
				// Prefer a pane that's still visible; otherwise show the next tab.
				activeSessionId = firstLeaf(layout).sessionId ?? nextTab;
				if (activeSessionId) {
					layout = showSession(layout, activeSessionId, activeSessionId);
				}
			}
			return { openTabs, activeSessionId, layout };
		});
		get().saveView();
	},

	closeOthers: (id) => {
		const { openTabs, sessions } = get();
		if (!openTabs.includes(id)) return;
		for (const sid of openTabs) {
			if (sid !== id && sessions[sid]?.kind === "terminal") {
				terminals.dispose(sid);
			}
		}
		// One tab left → collapse to a single full-screen pane showing it.
		set({ openTabs: [id], activeSessionId: id, layout: makeLeaf(id) });
		get().saveView();
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

	sendMessage: async (sessionId, text) => {
		try {
			await ipc.sendMessage(sessionId, text);
		} catch (error) {
			reportError("Failed to send message", error);
		}
	},

	cancel: async (sessionId) => {
		try {
			await ipc.cancelSession(sessionId);
		} catch (error) {
			reportError("Failed to cancel session", error);
		}
	},

	approveTools: async (sessionId, patterns) => {
		try {
			await ipc.approveTools(sessionId, patterns);
		} catch (error) {
			reportError("Failed to approve tools", error);
		}
	},

	approvePlan: async (sessionId) => {
		// Optimistically leave plan mode so the composer's mode chip updates
		// instantly; the backend emits the authoritative session-updated.
		const current = get().sessions[sessionId];
		if (current && current.permissionMode === "plan") {
			set((state) => ({
				sessions: {
					...state.sessions,
					[sessionId]: { ...current, permissionMode: "acceptEdits" },
				},
			}));
		}
		try {
			await ipc.approvePlan(sessionId);
		} catch (error) {
			if (current) {
				set((state) => ({
					sessions: { ...state.sessions, [sessionId]: current },
				}));
			}
			reportError("Failed to approve plan", error);
		}
	},

	resolveApproval: (sessionId, eventId) => {
		set((state) => ({
			approvalResolvedBySession: {
				...state.approvalResolvedBySession,
				[sessionId]: eventId,
			},
		}));
	},

	runPlanToCode: async (opts) => {
		const groupId = get().activeGroupId;
		if (!groupId) {
			reportError("No group selected", "Create a group first.");
			return;
		}
		const projectId = get().rootsByGroup[groupId]?.[0]?.id;
		if (!projectId) {
			reportError("No folder in this group", "Add a folder first.");
			return;
		}
		try {
			const result = await ipc.runPlanToCode({
				projectId,
				task: opts.task,
				plannerModel: opts.plannerModel,
				coderModel: opts.coderModel,
			});
			set((state) => {
				const sessions = { ...state.sessions };
				sessions[result.planner.id] = result.planner;
				sessions[result.coder.id] = result.coder;
				const groupSessions = [
					...(state.sessionsByGroup[groupId] ?? []),
					result.planner.id,
					result.coder.id,
				];
				const tabs = [...state.openTabs];
				for (const id of [result.planner.id, result.coder.id]) {
					if (!tabs.includes(id)) {
						tabs.push(id);
					}
				}
				return {
					sessions,
					sessionsByGroup: {
						...state.sessionsByGroup,
						[groupId]: groupSessions,
					},
					openTabs: tabs,
					activeSessionId: result.coder.id,
					layout: showSession(
						state.layout,
						state.activeSessionId,
						result.coder.id,
					),
					eventsBySession: {
						...state.eventsBySession,
						[result.planner.id]: state.eventsBySession[result.planner.id] ?? [],
						[result.coder.id]: state.eventsBySession[result.coder.id] ?? [],
					},
				};
			});
			get().saveView();
			void get().loadEvents(result.planner.id);
			void get().loadEvents(result.coder.id);
		} catch (error) {
			reportError("Failed to run plan to code", error);
		}
	},

	loadEvents: async (sessionId) => {
		set((state) => ({
			loadingEventsBySession: {
				...state.loadingEventsBySession,
				[sessionId]: true,
			},
		}));
		try {
			const events = await ipc.getEvents(sessionId);
			set((state) => ({
				eventsBySession: { ...state.eventsBySession, [sessionId]: events },
			}));
		} catch (error) {
			reportError("Failed to load events", error);
		} finally {
			set((state) => ({
				loadingEventsBySession: {
					...state.loadingEventsBySession,
					[sessionId]: false,
				},
			}));
		}
	},

	onAgentEvent: (record) => {
		set((state) => {
			const existing = state.eventsBySession[record.sessionId] ?? [];
			if (existing.some((e) => e.id === record.id)) {
				return state;
			}

			const eventsBySession = {
				...state.eventsBySession,
				[record.sessionId]: [...existing, record],
			};

			let streamingBySession = state.streamingBySession;
			if (record.type === "assistant_text" || record.type === "result") {
				if (state.streamingBySession[record.sessionId]) {
					streamingBySession = { ...state.streamingBySession };
					delete streamingBySession[record.sessionId];
				}
			}

			let sessions = state.sessions;
			if (record.type === "result") {
				const session = state.sessions[record.sessionId];
				if (session) {
					sessions = {
						...state.sessions,
						[record.sessionId]: {
							...session,
							costUsd:
								record.cost_usd !== null ? record.cost_usd : session.costUsd,
							turns:
								record.num_turns !== null ? record.num_turns : session.turns,
						},
					};
				}
			}

			return { eventsBySession, streamingBySession, sessions };
		});
	},

	onDelta: ({ sessionId, text }) => {
		set((state) => ({
			streamingBySession: {
				...state.streamingBySession,
				[sessionId]: (state.streamingBySession[sessionId] ?? "") + text,
			},
		}));
	},

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
}));
