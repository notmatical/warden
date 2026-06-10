import { Volume2 } from "lucide-react"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
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
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground text-sm">Sound volume</p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Applies to every notification sound.
            </p>
          </div>
          <Slider
            aria-label="Sound volume"
            className="w-32"
            max={100}
            min={0}
            onValueChange={([v]) => setNotifyVolume((v ?? 50) / 100)}
            step={5}
            value={[Math.round(prefs.volume * 100)]}
          />
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
                <label
                  htmlFor={`notify-${event}`}
                  className="font-medium text-foreground text-sm"
                >
                  {label}
                </label>
                <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
              </div>
              <Select
                value={pref.sound}
                onValueChange={(value) => {
                  const sound = value as SoundName
                  setNotifySound(event, sound)
                  playSound(sound, prefs.volume)
                }}
              >
                <SelectTrigger
                  aria-label={`${label} sound`}
                  className="w-28"
                  disabled={!pref.enabled}
                  size="sm"
                >
                  <SelectValue />
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
          <Button onClick={notifyTest} variant="secondary">
            Send test
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
