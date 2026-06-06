import { toast } from "sonner";
import type { StateCreator } from "zustand";

import * as ipc from "@/lib/ipc";
import { workflowTabId } from "@/lib/tab-ref";
import type { WorkflowRunView } from "@/types/workflow";

import { reportError } from "../shared";
import type { AppState } from "../types";

type WorkflowsSlice = Pick<
	AppState,
	| "workflows"
	| "workflowRun"
	| "sessionsByWorkflow"
	| "loadWorkflows"
	| "loadWorkflowSessions"
	| "ensureWorkflow"
	| "createWorkflow"
	| "saveWorkflowGraph"
	| "renameWorkflow"
	| "duplicateWorkflow"
	| "deleteWorkflow"
	| "openWorkflow"
	| "runWorkflowById"
	| "resumeRun"
	| "loadWorkflowRun"
	| "applyWorkflowRun"
>;

export const createWorkflowsSlice: StateCreator<
	AppState,
	[],
	[],
	WorkflowsSlice
> = (set, get) => ({
	workflows: {},
	workflowRun: null,
	sessionsByWorkflow: {},

	loadWorkflows: async (projectId) => {
		try {
			const list = await ipc.listWorkflows(projectId);
			// Merge — several groups/projects populate this for the sidebar.
			set((s) => ({
				workflows: {
					...s.workflows,
					...Object.fromEntries(list.map((w) => [w.id, w])),
				},
			}));
		} catch (error) {
			reportError("Failed to load workflows", error);
		}
	},

	loadWorkflowSessions: async (workflowId) => {
		try {
			const list = await ipc.listWorkflowSessions(workflowId);
			set((s) => ({
				sessions: {
					...s.sessions,
					...Object.fromEntries(list.map((x) => [x.id, x])),
				},
				sessionsByWorkflow: {
					...s.sessionsByWorkflow,
					[workflowId]: list.map((x) => x.id),
				},
			}));
		} catch (error) {
			reportError("Failed to load workflow sessions", error);
		}
	},

	ensureWorkflow: async (id) => {
		if (get().workflows[id]) return;
		try {
			const wf = await ipc.getWorkflow(id);
			set((s) => ({ workflows: { ...s.workflows, [wf.id]: wf } }));
		} catch (error) {
			reportError("Failed to load workflow", error);
		}
	},

	createWorkflow: async (projectId, name) => {
		try {
			const wf = await ipc.createWorkflow(projectId, name, {
				nodes: [],
				edges: [],
			});
			set((s) => ({ workflows: { ...s.workflows, [wf.id]: wf } }));
			return wf;
		} catch (error) {
			reportError("Failed to create workflow", error);
			return null;
		}
	},

	saveWorkflowGraph: async (id, graph) => {
		set((s) => {
			const wf = s.workflows[id];
			return wf
				? { workflows: { ...s.workflows, [id]: { ...wf, graph } } }
				: {};
		});
		try {
			await ipc.updateWorkflow(id, undefined, graph);
		} catch (error) {
			reportError("Failed to save workflow", error);
		}
	},

	renameWorkflow: async (id, name) => {
		set((s) => {
			const wf = s.workflows[id];
			return wf ? { workflows: { ...s.workflows, [id]: { ...wf, name } } } : {};
		});
		try {
			await ipc.updateWorkflow(id, name);
		} catch (error) {
			reportError("Failed to rename workflow", error);
		}
	},

	duplicateWorkflow: async (id) => {
		const wf = get().workflows[id];
		if (!wf) return null;
		try {
			const copy = await ipc.createWorkflow(
				wf.projectId,
				`${wf.name} copy`,
				wf.graph,
			);
			set((s) => ({ workflows: { ...s.workflows, [copy.id]: copy } }));
			return copy;
		} catch (error) {
			reportError("Failed to duplicate workflow", error);
			return null;
		}
	},

	deleteWorkflow: async (id) => {
		try {
			await ipc.deleteWorkflow(id);
			get().closeTab(workflowTabId(id));
			set((s) => {
				const next = { ...s.workflows };
				delete next[id];
				const nextSessions = { ...s.sessionsByWorkflow };
				delete nextSessions[id];
				return { workflows: next, sessionsByWorkflow: nextSessions };
			});
		} catch (error) {
			reportError("Failed to delete workflow", error);
		}
	},

	// Open a workflow as a real tab (closeable / splittable like a session).
	openWorkflow: (id) => {
		get().openTabRef(workflowTabId(id));
		set({ workflowRun: null });
		void get().ensureWorkflow(id);
	},

	runWorkflowById: async (id) => {
		try {
			const view = await ipc.runWorkflow(id, get().activeGroupId ?? undefined);
			set({ workflowRun: view });
		} catch (error) {
			reportError("Failed to run workflow", error);
		}
	},

	resumeRun: async (approve) => {
		const runId = get().workflowRun?.run.id;
		if (!runId) return;
		try {
			const view = await ipc.resumeWorkflow(runId, approve);
			set({ workflowRun: view });
		} catch (error) {
			reportError("Failed to resume workflow", error);
		}
	},

	loadWorkflowRun: async (id) => {
		try {
			const view = await ipc.getLatestWorkflowRun(id);
			set({ workflowRun: view });
		} catch (error) {
			reportError("Failed to load workflow run", error);
		}
	},

	applyWorkflowRun: (view: WorkflowRunView) => {
		const prev = get().workflowRun;
		if (!prev || prev.run.id === view.run.id) {
			// Warn when a node newly starts waiting on a user question.
			const wasWaiting = new Set(
				(prev?.nodes ?? [])
					.filter((n) => n.status === "awaitingInput")
					.map((n) => n.nodeId),
			);
			if (
				view.nodes.some(
					(n) => n.status === "awaitingInput" && !wasWaiting.has(n.nodeId),
				)
			) {
				toast.warning("A workflow agent is asking a question", {
					description:
						"Open the waiting node to answer so the run can continue.",
				});
			}
		}
		set((s) =>
			s.workflowRun && s.workflowRun.run.id !== view.run.id
				? {}
				: { workflowRun: view },
		);
	},
});
