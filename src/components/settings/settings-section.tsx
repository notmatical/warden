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
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6 border-border/60 border-b pb-4">
        <h2 className="font-semibold text-foreground text-lg leading-tight">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-prose text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  )
}
