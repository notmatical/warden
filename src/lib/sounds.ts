// Notification sounds: bundled audio files where we have one, Web Audio
// synthesis for the rest (short envelope-shaped tones, no binary assets).

import errorWavUrl from "@/assets/sounds/error.wav"
import notifyWavUrl from "@/assets/sounds/notify.wav"

export type SoundName = "notify" | "error" | "pop" | "none"

export const SOUND_OPTIONS: { value: SoundName; label: string }[] = [
  { value: "notify", label: "Notify" },
  { value: "error", label: "Error" },
  { value: "pop", label: "Pop" },
  { value: "none", label: "No sound" },
]

/** Whether a (possibly stale, persisted) value names a current sound. */
export function isSoundName(value: unknown): value is SoundName {
  return SOUND_OPTIONS.some((o) => o.value === value)
}

let ctx: AudioContext | null = null

function audioContext(): AudioContext {
  ctx ??= new AudioContext()
  // Autoplay policy can leave a fresh context suspended until a user
  // gesture; resume is a no-op when already running.
  if (ctx.state === "suspended") void ctx.resume()
  return ctx
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume))
}

// ---------------------------------------------------------------------------
// File-backed sounds (bundled assets, decoded once and cached)
// ---------------------------------------------------------------------------

const FILE_SOUNDS = {
  notify: notifyWavUrl,
  error: errorWavUrl,
} satisfies Partial<Record<SoundName, string>>

type FileSound = keyof typeof FILE_SOUNDS
type SynthSound = Exclude<SoundName, "none" | FileSound>

const bufferCache = new Map<string, Promise<AudioBuffer>>()

function loadBuffer(url: string): Promise<AudioBuffer> {
  let cached = bufferCache.get(url)
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => audioContext().decodeAudioData(data))
    cached.catch(() => bufferCache.delete(url))
    bufferCache.set(url, cached)
  }
  return cached
}

async function playFile(url: string, volume: number): Promise<void> {
  const ac = audioContext()
  const buffer = await loadBuffer(url)
  const source = ac.createBufferSource()
  source.buffer = buffer
  const gain = ac.createGain()
  // 0.6 roughly level-matches the full-scale assets to the quiet synths.
  gain.gain.value = clampVolume(volume) * 0.6
  source.connect(gain)
  gain.connect(ac.destination)
  source.start()
}

// ---------------------------------------------------------------------------
// Synthesized sounds
// ---------------------------------------------------------------------------

type Partial = {
  freq: number
  /** Seconds after the sound starts. */
  at?: number
  type?: OscillatorType
  /** Relative loudness of this partial (0–1). */
  gain?: number
  /** Exponential decay length in seconds. */
  decay?: number
  /** Optional frequency glide target (e.g. for the pop). */
  glideTo?: number
}

function playPartials(partials: Partial[], volume: number): void {
  const ac = audioContext()
  const now = ac.currentTime + 0.02
  // Master gain keeps even multi-partial sounds comfortably quiet.
  const master = ac.createGain()
  master.gain.value = clampVolume(volume) * 0.32
  master.connect(ac.destination)

  for (const p of partials) {
    const start = now + (p.at ?? 0)
    const decay = p.decay ?? 0.4
    const osc = ac.createOscillator()
    osc.type = p.type ?? "sine"
    osc.frequency.setValueAtTime(p.freq, start)
    if (p.glideTo)
      osc.frequency.exponentialRampToValueAtTime(p.glideTo, start + decay)

    const gain = ac.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(p.gain ?? 1, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay)

    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(start + decay + 0.05)
  }
}

const SYNTH_SOUNDS: Record<SynthSound, Partial[]> = {
  // Quick downward blip; barely-there.
  pop: [{ freq: 520, glideTo: 180, gain: 0.9, decay: 0.12 }],
}

/** Play a named notification sound at the given master volume (0–1).
 *  Best-effort: never throws into the UI. */
export function playSound(name: SoundName, volume: number): void {
  if (name === "none" || volume <= 0) return
  try {
    if (name in FILE_SOUNDS) {
      void playFile(FILE_SOUNDS[name as FileSound], volume).catch(() => {})
      return
    }
    playPartials(SYNTH_SOUNDS[name as SynthSound], volume)
  } catch {
    // Audio is best-effort (e.g. no output device).
  }
}
