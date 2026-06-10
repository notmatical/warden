import { SettingsSection } from "@/components/settings/settings-section"
import { Switch } from "@/components/ui/switch"
import { NOTIFY_EVENTS, setNotifyEnabled, useNotifyPrefs } from "@/lib/notify"

export function NotificationsSection() {
  const prefs = useNotifyPrefs()

  return (
    <SettingsSection
      title="Notifications"
      description="Desktop notifications shown while the window is in the background."
    >
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
        {NOTIFY_EVENTS.map(({ event, label, hint }) => (
          <div key={event} className="flex items-center gap-3.5 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`notify-${event}`}
                className="font-medium text-foreground text-sm"
              >
                {label}
              </label>
              <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
            </div>
            <Switch
              id={`notify-${event}`}
              checked={prefs[event]}
              onCheckedChange={(on) => setNotifyEnabled(event, on)}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
