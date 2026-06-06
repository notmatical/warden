/** Tabs/panes reference content by id. A bare id is a session (back-compat); a
 *  `workflow:<id>` ref is a workflow. Keeps the viewport generic over content. */

const WORKFLOW_PREFIX = "workflow:";

export function workflowTabId(workflowId: string): string {
	return WORKFLOW_PREFIX + workflowId;
}

export function isWorkflowTab(ref: string): boolean {
	return ref.startsWith(WORKFLOW_PREFIX);
}

export function workflowIdOf(ref: string): string {
	return ref.slice(WORKFLOW_PREFIX.length);
}
