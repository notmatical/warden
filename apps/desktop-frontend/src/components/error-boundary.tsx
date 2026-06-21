import { Component, type ErrorInfo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

interface State {
  error: Error | null
}

/** Top-level safety net: a thrown render/lifecycle error shows a recoverable
 *  fallback (with the message) instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-base font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The interface hit an unexpected error. Reloading usually clears it.
          </p>
        </div>
        <pre className="max-w-lg overflow-auto rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
          {error.message}
        </pre>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
}
