import type { WorkflowGraph } from "@/types/workflow"

/** A workflow encoded for sharing: a versioned envelope, gzipped when the
 *  runtime supports it, then base64url'd behind a recognizable prefix so the
 *  whole thing is a single copy-pasteable line. The id/projectId/timestamps are
 *  deliberately dropped — they're environment-specific and re-minted on import.
 *  Node/edge ids are internal to the graph, so they travel verbatim. */
const PREFIX = "warden-wf-"
const SCHEMA = "warden.workflow"
const VERSION = 1

/** `r` = raw JSON bytes, `z` = gzipped. Carried as the char right after PREFIX
 *  so decode knows how to read the payload without sniffing it. */
type Codec = "r" | "z"

interface WorkflowEnvelope {
  schema: typeof SCHEMA
  version: number
  name: string
  graph: WorkflowGraph
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ""
  // Per-byte loop (not spread) so large payloads don't blow the call stack.
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function gzip(
  bytes: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream("gzip")
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

async function gunzip(
  bytes: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream("gzip")
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** Encode a workflow into a single shareable code. */
export async function encodeWorkflow(
  name: string,
  graph: WorkflowGraph
): Promise<string> {
  const envelope: WorkflowEnvelope = {
    schema: SCHEMA,
    version: VERSION,
    name,
    graph,
  }
  const json = new TextEncoder().encode(JSON.stringify(envelope))
  if (typeof CompressionStream === "undefined") {
    return `${PREFIX}r${toBase64Url(json)}`
  }
  return `${PREFIX}z${toBase64Url(await gzip(json))}`
}

/** Decode a shared code back into a workflow's name + graph. Throws a
 *  user-facing Error if the code is malformed or not a Warden workflow. */
export async function decodeWorkflow(
  code: string
): Promise<{ name: string; graph: WorkflowGraph }> {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("That doesn't look like a Warden workflow code.")
  }
  const codec = trimmed[PREFIX.length] as Codec
  const body = trimmed.slice(PREFIX.length + 1)
  if (codec !== "r" && codec !== "z") {
    throw new Error("This workflow code uses an unsupported format.")
  }
  if (codec === "z" && typeof DecompressionStream === "undefined") {
    throw new Error("This build can't read compressed workflow codes.")
  }

  let json: string
  try {
    let bytes = fromBase64Url(body)
    if (codec === "z") bytes = await gunzip(bytes)
    json = new TextDecoder().decode(bytes)
  } catch {
    throw new Error("This workflow code is corrupted or incomplete.")
  }

  let env: Partial<WorkflowEnvelope>
  try {
    env = JSON.parse(json)
  } catch {
    throw new Error("This workflow code is corrupted or incomplete.")
  }

  if (
    !env ||
    env.schema !== SCHEMA ||
    !env.graph ||
    !Array.isArray(env.graph.nodes) ||
    !Array.isArray(env.graph.edges)
  ) {
    throw new Error("That code isn't a valid Warden workflow.")
  }

  const name =
    typeof env.name === "string" && env.name.trim()
      ? env.name.trim()
      : "Imported workflow"
  return { name, graph: { nodes: env.graph.nodes, edges: env.graph.edges } }
}
