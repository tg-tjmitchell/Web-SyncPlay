import { createLocalMediaEntry } from "@/server/media/local-media-store"
import { NextResponse } from "next/server"
import path from "node:path"

const ALLOWED_EXTENSIONS = new Set([".vtt", ".srt", ".ass", ".ssa"])
const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2MB

function getMimeType(ext: string): string {
  switch (ext) {
    case ".vtt":
      return "text/vtt"
    case ".ass":
    case ".ssa":
      return "text/x-ass"
    default:
      return "text/plain"
  }
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const roomId = String(formData.get("roomId") ?? "").trim()
  const ownerUserId = String(formData.get("ownerUserId") ?? "").trim()
  const file = formData.get("file")

  if (!roomId || !ownerUserId || !(file instanceof File)) {
    return NextResponse.json(
      { error: "roomId, ownerUserId and file are required" },
      { status: 400 },
    )
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Subtitle file too large (max 2MB)" },
      { status: 400 },
    )
  }

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: "Unsupported subtitle format. Allowed: .vtt, .srt, .ass, .ssa" },
      { status: 400 },
    )
  }

  const mimeType = getMimeType(ext)
  const buffer = new Uint8Array(await file.arrayBuffer())
  const entry = await createLocalMediaEntry({
    roomId,
    ownerUserId,
    filename: file.name,
    mimeType,
    bytes: buffer,
  })

  return NextResponse.json({
    subtitleId: entry.id,
    name: entry.filename,
    mimeType: entry.mimeType,
    url: `/api/subtitle/${encodeURIComponent(entry.id)}`,
  })
}
