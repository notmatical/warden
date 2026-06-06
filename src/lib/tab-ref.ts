/** Tabs/panes reference content by id. A bare id is a session (back-compat); a
 *  `workflow:<id>` ref is a workflow; `settings` is the (singleton) settings
 *  tab. Keeps the viewport generic over content. */

const WORKFLOW_PREFIX = "workflow:"

/** The settings tab is a singleton — there's only ever one of it. */
export const SETTINGS_TAB_ID = "settings"

export function workflowTabId(workflowId: string): string {
  return WORKFLOW_PREFIX + workflowId
}

export function isWorkflowTab(ref: string): boolean {
  return ref.startsWith(WORKFLOW_PREFIX)
}

export function workflowIdOf(ref: string): string {
  return ref.slice(WORKFLOW_PREFIX.length)
}

export function isSettingsTab(ref: string): boolean {
  return ref === SETTINGS_TAB_ID
}
