import { openUrl } from "@tauri-apps/plugin-opener"
import { useCommandState } from "cmdk"
import {
  ChevronRight,
  CircleDot,
  CircleX,
  FileDiff,
  FolderGit2,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Pin,
  PinOff,
  Search,
  Settings2,
  SquareTerminal,
  Sun,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react"
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { AgentProvidersIcon } from "@/components/agent-providers-icon"
import { ClaudeIcon, CodexIcon } from "@/components/icons/brand"
import { StatusDot } from "@/components/status-dot"
import { useTheme } from "@/components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { StatusIcon } from "@/integrations/linear/components/issue-icons"
import { IssuePeekPanel } from "@/integrations/linear/components/issue-peek-panel"
import { SendToAgentDialog } from "@/integrations/linear/components/send-to-agent-dialog"
import { linearCachedIssues, linearStatus } from "@/integrations/linear/ipc"
import type { LinearComment, LinearIssue } from "@/integrations/linear/types"
import { resolveCombo, subscribeUiCommand } from "@/lib/commands"
import { comboLabel } from "@/lib/keybindings"
import { defaultChatModel } from "@/lib/models"
import { isMac } from "@/lib/platform"
import {
  diffTabId,
  folderTabId,
  ISSUES_TAB_ID,
  WORKFLOWS_TAB_ID,
} from "@/lib/viewport"
import { useAppStore } from "@/store/app-store"
import type { Project, Session } from "@/types"

type FolderIntent = "agent" | "terminal" | "native-claude" | "native-codex"

type Page =
  | { id: "root" }
  | { id: "folders"; intent: FolderIntent }
  | { id: "linear" }
  | { id: "theme" }

const INTENT_TITLE: Record<FolderIntent, string> = {
  agent: "New agent session",
  terminal: "New terminal",
  "native-claude": "Native Claude",
  "native-codex": "Native Codex",
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

/** Mirrors cmdk's currently highlighted value into a ref, so keydown handlers
 *  (e.g. mod+Enter secondary actions) can read it without re-rendering. */
function SelectionTracker({ target }: { target: RefObject<string> }) {
  const value = useCommandState((state) => state.value)
  useEffect(() => {
    target.current = value ?? ""
  }, [value, target])
  return null
}

function SessionItem({
  session,
  project,
  onSelect,
}: {
  session: Session
  project: Project | undefined
  onSelect: () => void
}) {
  return (
    <CommandItem
      value={`session:${session.id}`}
      keywords={[
        session.title,
        project?.name ?? "",
        session.branch ?? "",
      ].filter(Boolean)}
      onSelect={onSelect}
    >
      {session.kind === "terminal" ? <SquareTerminal /> : <MessageSquare />}
      <span className="truncate">{session.title}</span>
      {session.status !== "idle" ? <StatusDot status={session.status} /> : null}
      <CommandShortcut className="max-w-32 truncate font-normal tracking-normal">
        {project?.name ?? ""}
      </CommandShortcut>
    </CommandItem>
  )
}

function IssueItem({
  issue,
  onSelect,
}: {
  issue: LinearIssue
  onSelect: () => void
}) {
  return (
    <CommandItem
      value={`linear:${issue.id}`}
      keywords={[
        issue.identifier,
        issue.title,
        issue.team.key,
        issue.state.name,
      ]}
      onSelect={onSelect}
    >
      <StatusIcon type={issue.state.type} color={issue.state.color} />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {issue.identifier}
      </span>
      <span className="truncate">{issue.title}</span>
    </CommandItem>
  )
}

/** The global Cmd+K palette: jump to sessions and folders, start new agent or
 *  terminal sessions, peek Linear issues, and run keybound commands.
 *  Sub-pages (folder picker, Linear search, theme) push onto the root;
 *  Backspace on an empty query or Escape pops back. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<Page>({ id: "root" })
  const [query, setQuery] = useState("")

  const [linearReady, setLinearReady] = useState(false)
  const [issues, setIssues] = useState<LinearIssue[]>([])

  // Follow-up surfaces that outlive the palette itself: the issue peek, and
  // the send-to-agent dialog it can hand off to.
  const [peekIssue, setPeekIssue] = useState<LinearIssue | null>(null)
  const [send, setSend] = useState<{
    issue: LinearIssue
    comments: LinearComment[]
  } | null>(null)

  const selectedValue = useRef("")
  const pageRef = useRef(page)
  pageRef.current = page

  const { theme, setTheme } = useTheme()
  const sessions = useAppStore((s) => s.sessions)
  const groups = useAppStore((s) => s.groups)
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)
  const workflows = useAppStore((s) => s.workflows)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const claudeAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "claude" && p.authed)
  )
  const codexAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "codex" && p.authed)
  )

  useEffect(
    () =>
      subscribeUiCommand("palette.toggle", () => {
        setOpen((o) => !o)
      }),
    []
  )

  // Reset to the root page and refresh Linear context on every open.
  useEffect(() => {
    if (!open) return
    setPage({ id: "root" })
    setQuery("")
    void linearStatus()
      .then(async ({ connected }) => {
        setLinearReady(connected)
        if (connected) setIssues(await linearCachedIssues())
      })
      .catch(() => setLinearReady(false))
  }, [open])

  // Own Escape while open (capture phase, ahead of the global keybinding
  // listener — otherwise Escape would also cancel the running turn): pop a
  // sub-page, or close from the root.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      if (pageRef.current.id === "root") {
        setOpen(false)
      } else {
        setPage({ id: "root" })
        setQuery("")
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open])

  const goTo = (next: Page) => {
    setPage(next)
    setQuery("")
  }

  const dismiss = () => setOpen(false)

  const activeSession = activeTabId ? sessions[activeTabId] : undefined

  const projectById = useMemo(() => {
    const map = new Map<string, Project>()
    for (const roots of Object.values(rootsByGroup))
      for (const root of roots) map.set(root.id, root)
    return map
  }, [rootsByGroup])

  // Pinned first, then most recently active. The root shows a short list;
  // once the user types, everything is rendered and cmdk ranks it.
  const jumpSessions = useMemo(() => {
    const all = Object.values(sessions)
      .filter((s) => s.id !== activeTabId)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt.localeCompare(a.updatedAt)
      )
    return query ? all : all.slice(0, 6)
  }, [sessions, activeTabId, query])

  const folderPairs = useMemo(
    () =>
      groups.flatMap((group) =>
        (rootsByGroup[group.id] ?? []).map((project) => ({ group, project }))
      ),
    [groups, rootsByGroup]
  )

  const sortedIssues = useMemo(
    () => [...issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [issues]
  )
  const rootIssues = query ? sortedIssues : sortedIssues.slice(0, 4)

  const workflowList = useMemo(() => Object.values(workflows), [workflows])

  const openRef = (ref: string) => {
    useAppStore.getState().openTab(ref)
    dismiss()
  }

  const jumpTo = (id: string) => {
    useAppStore.getState().openSession(id)
    dismiss()
  }

  const startInFolder = (
    intent: FolderIntent,
    groupId: string,
    projectId: string
  ) => {
    const store = useAppStore.getState()
    dismiss()
    switch (intent) {
      case "agent":
      case "terminal":
        void store.createSession({
          projectId,
          groupId,
          title: intent === "terminal" ? "Terminal" : "New session",
          model: defaultChatModel(),
          permissionMode: "bypassPermissions",
          role: "chat",
          kind: intent,
        })
        break
      case "native-claude":
        void store.createNativeSession(projectId, "claude")
        break
      case "native-codex":
        void store.createNativeSession(projectId, "codex")
        break
    }
  }

  // Peek first: Enter previews the issue; "Send to Agent" lives in the panel.
  const pickIssue = (issue: LinearIssue) => {
    dismiss()
    setPeekIssue(issue)
  }

  // Mod+Enter on a highlighted Linear issue opens it in the browser instead.
  const onCommandKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
    const value = selectedValue.current
    if (!value.startsWith("linear:")) return
    const issue = sortedIssues.find((i) => `linear:${i.id}` === value)
    if (!issue) return
    event.preventDefault()
    void openUrl(issue.url)
    dismiss()
  }

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Backspace" && query === "" && page.id !== "root") {
      event.preventDefault()
      goTo({ id: "root" })
    }
  }

  const pageTitle =
    page.id === "folders"
      ? INTENT_TITLE[page.intent]
      : page.id === "linear"
        ? "Linear issues"
        : page.id === "theme"
          ? "Theme"
          : null

  const placeholder =
    page.id === "folders"
      ? "Choose a folder…"
      : page.id === "linear"
        ? "Search Linear issues…"
        : page.id === "theme"
          ? "Choose a theme…"
          : "Search sessions, issues, actions…"

  const modEnter = isMac ? "⌘ ⏎" : "Ctrl ⏎"
  const hint =
    page.id === "linear" ? (
      <>
        <Kbd>⏎</Kbd> preview the issue
        <span className="px-1">·</span>
        <Kbd>{modEnter}</Kbd> open in Linear
      </>
    ) : page.id === "folders" ? (
      "The session starts in the folder you choose"
    ) : page.id === "theme" ? (
      "Applies immediately"
    ) : (
      <>
        <Kbd>↑↓</Kbd> navigate
        <span className="px-1">·</span>
        <Kbd>⏎</Kbd> select
      </>
    )

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-xl">
        <Command loop onKeyDown={onCommandKeyDown}>
          <SelectionTracker target={selectedValue} />
          {pageTitle ? (
            <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
              <span>Warden</span>
              <ChevronRight className="size-3" />
              <span className="font-medium text-foreground">{pageTitle}</span>
            </div>
          ) : null}
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            onKeyDown={onInputKeyDown}
          />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>
              {page.id === "folders"
                ? "No folders yet. Add one from the sidebar."
                : page.id === "linear"
                  ? "No matching issues."
                  : "No results."}
            </CommandEmpty>

            {page.id === "root" ? (
              <>
                {activeSession ? (
                  <CommandGroup heading="Current session">
                    {activeSession.status === "running" ? (
                      <CommandItem
                        value="current:cancel"
                        keywords={["cancel", "stop", "interrupt"]}
                        onSelect={() => {
                          void useAppStore.getState().cancel(activeSession.id)
                          dismiss()
                        }}
                      >
                        <CircleX />
                        Cancel the running turn
                        <CommandShortcut className="tracking-normal">
                          {comboLabel(resolveCombo("session.cancel"))}
                        </CommandShortcut>
                      </CommandItem>
                    ) : null}
                    <CommandItem
                      value="current:diff"
                      keywords={["diff", "changes", "files", "review"]}
                      onSelect={() => openRef(diffTabId(activeSession.id))}
                    >
                      <FileDiff />
                      Open changes
                    </CommandItem>
                    <CommandItem
                      value="current:pin"
                      keywords={["pin", "favorite"]}
                      onSelect={() => {
                        void useAppStore
                          .getState()
                          .setSessionPinned(
                            activeSession.id,
                            !activeSession.pinned
                          )
                        dismiss()
                      }}
                    >
                      {activeSession.pinned ? <PinOff /> : <Pin />}
                      {activeSession.pinned ? "Unpin session" : "Pin session"}
                    </CommandItem>
                    <CommandItem
                      value="current:close"
                      keywords={["close", "tab"]}
                      onSelect={() => {
                        useAppStore.getState().closeTab(activeSession.id)
                        dismiss()
                      }}
                    >
                      <X />
                      Close tab
                    </CommandItem>
                  </CommandGroup>
                ) : null}

                {jumpSessions.length > 0 ? (
                  <CommandGroup heading="Jump to">
                    {jumpSessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        project={projectById.get(session.projectId)}
                        onSelect={() => jumpTo(session.id)}
                      />
                    ))}
                  </CommandGroup>
                ) : null}

                <CommandGroup heading="Start">
                  <CommandItem
                    value="start:agent"
                    keywords={["new", "session", "agent", "create"]}
                    onSelect={() => goTo({ id: "folders", intent: "agent" })}
                  >
                    <AgentProvidersIcon className="size-4" />
                    New agent session…
                  </CommandItem>
                  <CommandItem
                    value="start:terminal"
                    keywords={["new", "terminal", "shell", "create"]}
                    onSelect={() => goTo({ id: "folders", intent: "terminal" })}
                  >
                    <SquareTerminal />
                    New terminal…
                  </CommandItem>
                  {claudeAuthed ? (
                    <CommandItem
                      value="start:native-claude"
                      keywords={["new", "native", "claude", "cli"]}
                      onSelect={() =>
                        goTo({ id: "folders", intent: "native-claude" })
                      }
                    >
                      <ClaudeIcon />
                      Native Claude…
                    </CommandItem>
                  ) : null}
                  {codexAuthed ? (
                    <CommandItem
                      value="start:native-codex"
                      keywords={["new", "native", "codex", "cli"]}
                      onSelect={() =>
                        goTo({ id: "folders", intent: "native-codex" })
                      }
                    >
                      <CodexIcon />
                      Native Codex…
                    </CommandItem>
                  ) : null}
                </CommandGroup>

                {linearReady && sortedIssues.length > 0 ? (
                  <CommandGroup heading="Linear">
                    {rootIssues.map((issue) => (
                      <IssueItem
                        key={issue.id}
                        issue={issue}
                        onSelect={() => pickIssue(issue)}
                      />
                    ))}
                    {!query ? (
                      <CommandItem
                        value="linear:browse"
                        keywords={["linear", "issues", "search"]}
                        onSelect={() => goTo({ id: "linear" })}
                      >
                        <Search />
                        Search all Linear issues…
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                ) : null}

                <CommandGroup heading="Navigate">
                  {[...projectById.values()].map((project) => (
                    <CommandItem
                      key={project.id}
                      value={`folder:${project.id}`}
                      keywords={[project.name, "folder", "repo"]}
                      onSelect={() => openRef(folderTabId(project.id))}
                    >
                      <FolderGit2 />
                      <span className="truncate">{project.name}</span>
                    </CommandItem>
                  ))}
                  {workflowList.map((workflow) => (
                    <CommandItem
                      key={workflow.id}
                      value={`workflow:${workflow.id}`}
                      keywords={[workflow.name, "workflow"]}
                      onSelect={() => {
                        useAppStore.getState().openWorkflow(workflow.id)
                        dismiss()
                      }}
                    >
                      <WorkflowIcon />
                      <span className="truncate">{workflow.name}</span>
                    </CommandItem>
                  ))}
                  <CommandItem
                    value="nav:issues"
                    keywords={["issues", "tasks", "linear", "github"]}
                    onSelect={() => openRef(ISSUES_TAB_ID)}
                  >
                    <CircleDot />
                    Issues
                  </CommandItem>
                  <CommandItem
                    value="nav:workflows"
                    keywords={["workflows"]}
                    onSelect={() => openRef(WORKFLOWS_TAB_ID)}
                  >
                    <WorkflowIcon />
                    Workflows
                  </CommandItem>
                  <CommandItem
                    value="nav:settings"
                    keywords={["settings", "preferences", "integrations"]}
                    onSelect={() => {
                      useAppStore.getState().openSettings()
                      dismiss()
                    }}
                  >
                    <Settings2 />
                    Settings
                  </CommandItem>
                  <CommandItem
                    value="nav:theme"
                    keywords={["theme", "dark", "light", "appearance", "mode"]}
                    onSelect={() => goTo({ id: "theme" })}
                  >
                    <Palette />
                    Change theme…
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}

            {/* cmdk only auto-hides groups when a search filters their items
                out, so empty pages must skip the group to keep the heading
                from rendering above the empty state. */}
            {page.id === "folders" && folderPairs.length > 0 ? (
              <CommandGroup heading="Folders">
                {folderPairs.map(({ group, project }) => (
                  <CommandItem
                    key={`${group.id}:${project.id}`}
                    value={`pick:${group.id}:${project.id}`}
                    keywords={[project.name, group.name]}
                    onSelect={() =>
                      startInFolder(page.intent, group.id, project.id)
                    }
                  >
                    <FolderGit2 />
                    <span className="truncate">{project.name}</span>
                    <CommandShortcut className="max-w-32 truncate font-normal tracking-normal">
                      {group.name}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {page.id === "linear" && sortedIssues.length > 0 ? (
              <CommandGroup heading="Issues">
                {sortedIssues.map((issue) => (
                  <IssueItem
                    key={issue.id}
                    issue={issue}
                    onSelect={() => pickIssue(issue)}
                  />
                ))}
              </CommandGroup>
            ) : null}

            {page.id === "theme" ? (
              <CommandGroup heading="Theme">
                {THEME_OPTIONS.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`theme:${option.value}`}
                    data-checked={theme === option.value ? "true" : undefined}
                    onSelect={() => {
                      setTheme(option.value)
                      dismiss()
                    }}
                  >
                    <option.icon />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="flex min-w-0 items-center truncate">{hint}</span>
            {page.id === "root" ? (
              <Kbd className="shrink-0">
                {comboLabel(resolveCombo("palette.toggle"))}
              </Kbd>
            ) : (
              <span className="flex shrink-0 items-center gap-1">
                <Kbd>Esc</Kbd> back
              </span>
            )}
          </div>
        </Command>
      </CommandDialog>

      <IssuePeekPanel
        open={peekIssue !== null}
        issue={peekIssue}
        onOpenChange={(o) => {
          if (!o) setPeekIssue(null)
        }}
        onSendToAgent={(issue, comments) => setSend({ issue, comments })}
      />
      <SendToAgentDialog
        issue={send?.issue ?? null}
        comments={send?.comments ?? []}
        open={send !== null}
        onOpenChange={(o) => {
          if (!o) setSend(null)
        }}
        onSent={() => setPeekIssue(null)}
      />
    </>
  )
}
