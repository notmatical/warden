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
import { Volume2 } from "lucide-react"

import { SettingsSection } from "@/components/settings/settings-section"
import { ToolList } from "@/components/settings/tool-list"
import {
  NOTIFY_EVENTS,
  notifyTest,
  setNotifyEnabled,
  setNotifySound,
  setNotifyVolume,
  useNotifyPrefs,
} from "@/lib/notify"
import { playSound, SOUND_OPTIONS, type SoundName } from "@/lib/sounds"

export function NotificationsSection() {
  const prefs = useNotifyPrefs()

  return (
    <SettingsSection
      title="Notifications"
      description="Popup notifications shown while the window is in the background."
    >
      <ToolList>
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground text-sm">Sound volume</p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Applies to every notification sound.
            </p>
          </div>
          {/* Fixed-width wrapper + control min-width override: coss's Slider
              defaults to w-full / min-w-44, which would swamp the row. */}
          <div className="w-36 shrink-0">
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
            <Volume2 />
          </Button>
        </div>

        {NOTIFY_EVENTS.map(({ event, label, hint }) => {
          const pref = prefs.events[event]
          return (
            <div key={event} className="flex items-center gap-3.5 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={`notify-${event}`}
                  className="font-medium text-foreground text-sm"
                >
                  {label}
                </Label>
                <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
              </div>
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
            </div>
          )
        })}

        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground text-sm">
              Test notification
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Send a sample popup to check the look and sound.
            </p>
          </div>
          <Button onClick={notifyTest} variant="secondary" size="sm">
            Send test
          </Button>
        </div>
      </ToolList>
    </SettingsSection>
  )
}
