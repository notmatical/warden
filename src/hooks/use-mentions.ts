import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"

import {
  MENTION_PROVIDERS,
  detectMention,
  filterMentions,
  type ActiveMention,
  type MentionChar,
  type MentionItem,
} from "@/lib/mentions"

interface UseMentionsArgs {
  value: string
  onChange: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  workingDir: string | null
}

export interface UseMentionsResult {
  active: boolean
  char: MentionChar | null
  items: MentionItem[]
  selectedIndex: number
  loading: boolean
  emptyLabel: string
  setSelectedIndex: (index: number) => void
  select: (item: MentionItem) => void
  /** Call from the textarea's onChange, after updating the value. */
  handleInput: (value: string, cursor: number) => void
  /** Call from the textarea's onKeyDown; returns true if it consumed the key. */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

export function useMentions({
  value,
  onChange,
  textareaRef,
  workingDir,
}: UseMentionsArgs): UseMentionsResult {
  const [active, setActive] = useState<ActiveMention | null>(null)
  const [pool, setPool] = useState<MentionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const cursorRef = useRef(0)
  const cacheRef = useRef(new Map<string, MentionItem[]>())

  // Load the candidate pool when the trigger char (or workspace) changes; the
  // per-keystroke query is applied by `filterMentions` below.
  useEffect(() => {
    if (!active || !workingDir) {
      setPool([])
      return
    }
    const key = `${active.char}:${workingDir}`
    const cached = cacheRef.current.get(key)
    if (cached) {
      setPool(cached)
      return
    }
    let cancelled = false
    setLoading(true)
    MENTION_PROVIDERS[active.char]
      .load({ workingDir })
      .then((items) => {
        cacheRef.current.set(key, items)
        if (!cancelled) setPool(items)
      })
      .catch(() => {
        if (!cancelled) setPool([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Only re-load when the trigger char or workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.char, workingDir])

  const items = useMemo(
    () => (active ? filterMentions(pool, active.query) : []),
    [active, pool]
  )

  // Reset the highlight as the query or pool changes.
  useEffect(() => {
    setSelectedIndex(0)
  }, [active?.char, active?.query, pool])

  const handleInput = useCallback(
    (nextValue: string, cursor: number) => {
      cursorRef.current = cursor
      setActive(workingDir ? detectMention(nextValue, cursor) : null)
    },
    [workingDir]
  )

  const select = useCallback(
    async (item: MentionItem) => {
      if (!active || !workingDir) return
      // Capture the splice bounds before any async resolve.
      const before = value.slice(0, active.index)
      const after = value.slice(cursorRef.current)
      setActive(null)

      const insert = await MENTION_PROVIDERS[active.char].resolve(item, {
        workingDir,
      })
      const nextValue = before + insert + after
      const nextCursor = before.length + insert.length
      onChange(nextValue)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(nextCursor, nextCursor)
        }
      })
    },
    [active, workingDir, value, onChange, textareaRef]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!active) return false

      if (items.length === 0) {
        if (event.key === "Escape") {
          event.preventDefault()
          setActive(null)
          return true
        }
        return false
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        case "ArrowUp":
          event.preventDefault()
          setSelectedIndex((i) => (i - 1 + items.length) % items.length)
          return true
        case "Enter":
          event.preventDefault()
          void select(items[selectedIndex])
          return true
        case "Tab":
          if (event.shiftKey) return false // leave Shift+Tab for mode cycling
          event.preventDefault()
          void select(items[selectedIndex])
          return true
        case "Escape":
          event.preventDefault()
          setActive(null)
          return true
        default:
          return false
      }
    },
    [active, items, selectedIndex, select]
  )

  return {
    active: active != null,
    char: active?.char ?? null,
    items,
    selectedIndex,
    loading,
    emptyLabel: active ? MENTION_PROVIDERS[active.char].emptyLabel : "",
    setSelectedIndex,
    select,
    handleInput,
    handleKeyDown,
  }
}
