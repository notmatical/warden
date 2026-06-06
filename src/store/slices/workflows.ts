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
	| "loadWorkflows"
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

	loadWorkflows: async (projectId) => {
		try {
			const list = await ipc.listWorkflows(projectId);
			set({ workflows: Object.fromEntries(list.map((w) => [w.id, w])) });
		} catch (error) {
			reportError("Failed to load workflows", error);
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
				return { workflows: next };
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
		set((s) =>
			s.workflowRun && s.workflowRun.run.id !== view.run.id
				? {}
				: { workflowRun: view },
		);
	},
});
