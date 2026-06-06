import type { ReactNode } from "react"

/** Shared shell for a settings section. Keeps width, header typography, and
 *  rhythm consistent across every section (Providers, Integrations, future
 *  Editor / Terminal / Keybindings). New sections supply only the title +
 *  description + content — never their own header chrome. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="w-full max-w-4xl px-2 py-2">
      <header className="mb-5 flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-prose text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  )
}
