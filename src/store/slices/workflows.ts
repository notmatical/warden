import type { StateCreator } from "zustand";

import * as ipc from "@/lib/ipc";
import type { WorkflowRunView } from "@/types/workflow";

import { reportError } from "../shared";
import type { AppState } from "../types";

type WorkflowsSlice = Pick<
	AppState,
	| "workflows"
	| "activeWorkflowId"
	| "workflowRun"
	| "loadWorkflows"
	| "createWorkflow"
	| "saveWorkflowGraph"
	| "renameWorkflow"
	| "duplicateWorkflow"
	| "deleteWorkflow"
	| "openWorkflow"
	| "closeWorkflow"
	| "runActiveWorkflow"
	| "applyWorkflowRun"
>;

export const createWorkflowsSlice: StateCreator<
	AppState,
	[],
	[],
	WorkflowsSlice
> = (set, get) => ({
	workflows: {},
	activeWorkflowId: null,
	workflowRun: null,

	loadWorkflows: async (projectId) => {
		try {
			const list = await ipc.listWorkflows(projectId);
			set({ workflows: Object.fromEntries(list.map((w) => [w.id, w])) });
		} catch (error) {
			reportError("Failed to load workflows", error);
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
			set((s) => {
				const next = { ...s.workflows };
				delete next[id];
				return {
					workflows: next,
					activeWorkflowId:
						s.activeWorkflowId === id ? null : s.activeWorkflowId,
				};
			});
		} catch (error) {
			reportError("Failed to delete workflow", error);
		}
	},

	openWorkflow: (id) => set({ activeWorkflowId: id, workflowRun: null }),
	closeWorkflow: () => set({ activeWorkflowId: null, workflowRun: null }),

	runActiveWorkflow: async () => {
		const id = get().activeWorkflowId;
		if (!id) return;
		try {
			const view = await ipc.runWorkflow(id, get().activeGroupId ?? undefined);
			set({ workflowRun: view });
		} catch (error) {
			reportError("Failed to run workflow", error);
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
