import { Button } from "@warden/ui/components/button"
import { Label } from "@warden/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@warden/ui/components/select"
import { Slider } from "@warden/ui/components/slider"
import { Switch } from "@warden/ui/components/switch"
import {
  BellRing,
  CircleCheck,
  GitPullRequest,
  Inbox,
  type LucideIcon,
  Play,
  Volume2,
  Workflow,
} from "lucide-react"
import type { ComponentType, ReactNode } from "react"

import { SettingsSection } from "@/components/settings/settings-section"
import {
  NOTIFY_EVENTS,
  type NotifyEvent,
  notifyTest,
  setNotifyEnabled,
  setNotifySound,
  setNotifyVolume,
  useNotifyPrefs,
} from "@/lib/notify"
import { playSound, SOUND_OPTIONS, type SoundName } from "@/lib/sounds"

const EVENT_ICON: Record<NotifyEvent, LucideIcon> = {
  sessionDone: CircleCheck,
  workflowDone: Workflow,
  prChecks: GitPullRequest,
  linearAssigned: Inbox,
}

/** A settings row: an icon tile (echoing the card tiles) + title/hint on the
 *  left, controls on the right. */
function SettingRow({
  icon: Icon,
  title,
  hint,
  htmlFor,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  hint: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border/60">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <Label
            htmlFor={htmlFor}
            className="font-medium text-foreground text-sm"
          >
            {title}
          </Label>
        ) : (
          <p className="font-medium text-foreground text-sm">{title}</p>
        )}
        <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">{children}</div>
    </div>
  )
}

export function NotificationsSection() {
  const prefs = useNotifyPrefs()

  return (
    <SettingsSection
      title="Notifications"
      description="Popup notifications shown while the window is in the background."
    >
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs">
        <SettingRow
          icon={Volume2}
          title="Sound volume"
          hint="Applies to every notification sound."
        >
          {/* Fixed-width wrapper + control min-width override: coss's Slider
              defaults to w-full / min-w-44, which would swamp the row. */}
          <div className="w-36">
            <Slider
              aria-label="Sound volume"
              className="[&_[data-slot=slider-control]]:!min-w-0"
              max={100}
              min={0}
              step={5}
              value={[Math.round(prefs.volume * 100)]}
              onValueChange={(v) => {
                const next = Array.isArray(v) ? (v[0] ?? 50) : v
                setNotifyVolume(next / 100)
              }}
            />
          </div>
          <Button
            aria-label="Preview volume"
            onClick={() => playSound("notify", prefs.volume)}
            size="icon-sm"
            variant="ghost"
          >
            <Play />
          </Button>
        </SettingRow>

        {NOTIFY_EVENTS.map(({ event, label, hint }) => {
          const pref = prefs.events[event]
          return (
            <SettingRow
              key={event}
              icon={EVENT_ICON[event]}
              title={label}
              hint={hint}
              htmlFor={`notify-${event}`}
            >
              <Select
                value={pref.sound}
                disabled={!pref.enabled}
                onValueChange={(value) => {
                  const sound = value as SoundName
                  setNotifySound(event, sound)
                  playSound(sound, prefs.volume)
                }}
              >
                <SelectTrigger
                  aria-label={`${label} sound`}
                  size="sm"
                  className="w-28"
                >
                  <SelectValue>
                    {(value) =>
                      SOUND_OPTIONS.find((o) => o.value === value)?.label ??
                      String(value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SOUND_OPTIONS.map(({ value, label: soundLabel }) => (
                    <SelectItem key={value} value={value}>
                      {soundLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch
                id={`notify-${event}`}
                checked={pref.enabled}
                onCheckedChange={(on) => setNotifyEnabled(event, on)}
              />
            </SettingRow>
          )
        })}

        <SettingRow
          icon={BellRing}
          title="Test notification"
          hint="Send a sample popup to check the look and sound."
        >
          <Button onClick={notifyTest} variant="secondary" size="sm">
            Send test
          </Button>
        </SettingRow>
      </div>
    </SettingsSection>
  )
}
