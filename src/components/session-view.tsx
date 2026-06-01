import { Composer } from "@/components/composer"
import { Transcript } from "@/components/transcript"
import { useAppStore } from "@/store/app-store"

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])

  if (!session) {
    return null
  }

  // The transcript fills the space and scrolls *under* the floating composer,
  // which fades in over a gradient (no hard footer, no per-session header).
  return (
    <div className="relative h-full">
      <Transcript sessionId={sessionId} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-12 bg-gradient-to-t from-background to-transparent" />
        <div className="pointer-events-auto bg-background">
          <Composer sessionId={sessionId} />
        </div>
      </div>
    </div>
  )
}
