import type { ComponentType } from "react"
import {
  CircleDot,
  ListTodo,
  type LucideIcon,
  Settings2,
  SquareTerminal,
  Workflow as WorkflowIcon,
} from "lucide-react"

import { IssuesView } from "@/components/issues-view"
import { SessionPane } from "@/components/session-view"
import { SettingsPanel } from "@/components/settings/settings-panel"
import { TasksView } from "@/components/tasks-view"
import { WorkflowEditor } from "@/components/workflow/workflow-editor"
import { WorkflowsView } from "@/components/workflows-view"
import type { AppState } from "@/store/types"
import { type ContentKind, kindOf, workflowIdOf } from "./content-kinds"

/** The render half of the viewport engine: how each content kind looks and which
 *  component fills the pane. Components consult `describe(ref)`; adding a kind is
 *  a single entry here plus its pure metadata in `content-kinds.ts`. */
export interface ContentDescriptor {
  kind: ContentKind
  /** Static glyph for non-session tabs/headers and primary-nav entries.
   *  (Sessions render their own status-aware favicon.) */
  icon: LucideIcon
  /** The component rendered in the pane body. */
  View: ComponentType<{ refId: string }>
  /** Display title, resolved against app state (workflow name, session title…). */
  title: (state: AppState, ref: string) => string | undefined
}

type Entry = Omit<ContentDescriptor, "kind">

const REGISTRY: Partial<Record<ContentKind, Entry>> = {
  session: {
    icon: SquareTerminal,
    View: SessionPane,
    title: (s, ref) => s.sessions[ref]?.title,
  },
  workflow: {
    icon: WorkflowIcon,
    View: ({ refId }) => <WorkflowEditor workflowId={workflowIdOf(refId)} />,
    title: (s, ref) => s.workflows[workflowIdOf(ref)]?.name ?? "Workflow",
  },
  workflows: {
    icon: WorkflowIcon,
    View: () => <WorkflowsView />,
    title: () => "Workflows",
  },
  settings: {
    icon: Settings2,
    View: () => <SettingsPanel />,
    title: () => "Settings",
  },
  tasks: {
    icon: ListTodo,
    View: () => <TasksView />,
    title: () => "Tasks",
  },
  issues: {
    icon: CircleDot,
    View: () => <IssuesView />,
    title: () => "Issues",
  },
}

/** Join a ref's kind with its presentation. Unknown kinds fall back to session. */
export function describe(ref: string): ContentDescriptor {
  const kind = kindOf(ref)
  const entry = REGISTRY[kind] ?? (REGISTRY.session as Entry)
  return { kind, ...entry }
}

/** Render a pane's body for any ref by dispatching through the registry. */
export function PaneContent({ refId }: { refId: string }) {
  const { View } = describe(refId)
  return <View refId={refId} />
}
