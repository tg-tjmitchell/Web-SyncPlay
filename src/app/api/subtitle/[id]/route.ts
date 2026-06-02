import { getLocalMediaEntry } from "@/server/media/local-media-store"
import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return NextResponse.json({ error: "Subtitle not found" }, { status: 404 })
  }

  try {
    const fileBytes = await fs.readFile(entry.tempFilePath)
    return new Response(fileBytes, {
      status: 200,
      headers: {
        "content-type": entry.mimeType,
        "content-length": String(entry.sizeBytes),
        "cache-control": "public, max-age=3600",
        // Allow cross-origin access so vidstack/jassub can fetch the subtitle file
        "access-control-allow-origin": "*",
      },
    })
  } catch {
    return NextResponse.json({ error: "Subtitle not found" }, { status: 404 })
  }
}
