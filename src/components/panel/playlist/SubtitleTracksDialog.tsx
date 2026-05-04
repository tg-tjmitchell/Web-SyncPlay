"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { PlaylistItem } from "@/zod/types"
import { Captions, Plus, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

const SUBTITLE_ACCEPT = ".vtt,.srt,.ass,.ssa"

function formatTrackLabel(item: PlaylistItem): string {
  if (!item.textTracks || item.textTracks.length === 0) {
    return "Subtitles"
  }
  return `Subtitles (${item.textTracks.length})`
}

export function SubtitleTracksDialog(props: {
  item: PlaylistItem
  roomId: string
  userId: string
  send: TypedRoomEventSender
  canControl: boolean
}) {
  const { item, roomId, userId, send, canControl } = props

  const [open, setOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [labelInput, setLabelInput] = useState("")
  const [languageInput, setLanguageInput] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetForm = () => {
    setUrlInput("")
    setLabelInput("")
    setLanguageInput("")
  }

  const addByUrl = () => {
    const src = urlInput.trim()
    const label = labelInput.trim()
    if (!src || !label) {
      toast.error("URL and label are required")
      return
    }
    const ext = src.split(".").pop()?.toLowerCase()
    const type =
      ext === "vtt"
        ? "text/vtt"
        : ext === "ass" || ext === "ssa"
          ? "text/x-ass"
          : undefined
    send("playlist:text-track:add", {
      itemId: item.id,
      src,
      label,
      language: languageInput.trim() || undefined,
      kind: "subtitles",
      type,
    })
    toast.success("Subtitle track added")
    resetForm()
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set("roomId", roomId)
      formData.set("ownerUserId", userId)
      formData.set("file", file)
      const response = await fetch("/api/subtitle", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(err.error ?? "Upload failed")
      }
      const payload = (await response.json()) as {
        url: string
        name: string
        mimeType: string
      }
      const ext = file.name.split(".").pop()?.toLowerCase()
      const type =
        ext === "vtt"
          ? "text/vtt"
          : ext === "ass" || ext === "ssa"
            ? "text/x-ass"
            : "text/plain"
      const autoLabel = file.name.replace(/\.[^.]+$/, "")
      send("playlist:text-track:add", {
        itemId: item.id,
        src: payload.url,
        label: autoLabel,
        kind: "subtitles",
        type,
      })
      toast.success("Subtitle file uploaded")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed"
      console.error("[subtitles] upload error", error)
      toast.error(message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const removeTrack = (trackId: string) => {
    send("playlist:text-track:select", {
      itemId: item.id,
      textTrackId:
        item.selectedTextTrackId === trackId ? null : item.selectedTextTrackId ?? null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Manage subtitles"
            title="Manage subtitles"
          />
        }
      >
        <Captions className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{formatTrackLabel(item)}</DialogTitle>
        </DialogHeader>

        {/* Existing tracks */}
        {item.textTracks && item.textTracks.length > 0 && (
          <div className="space-y-1">
            {item.textTracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {track.label}
                  {track.language && (
                    <span className="ml-1 text-muted-foreground">
                      ({track.language})
                    </span>
                  )}
                  {track.type && (
                    <span className="ml-1 text-muted-foreground">
                      · {track.type}
                    </span>
                  )}
                </span>
                {canControl && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove track"
                    onClick={() => removeTrack(track.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {!item.textTracks || item.textTracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subtitle tracks yet.
          </p>
        ) : null}

        {/* Add new track */}
        {canControl && (
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-medium">Add subtitle track</p>

            <div className="space-y-1.5">
              <Label className="text-xs">URL</Label>
              <Input
                placeholder="https://example.com/subtitles.vtt"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  placeholder="English"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Language (optional)</Label>
                <Input
                  placeholder="en"
                  value={languageInput}
                  onChange={(e) => setLanguageInput(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!urlInput.trim() || !labelInput.trim()}
              onClick={addByUrl}
            >
              <Plus className="mr-1 size-3.5" />
              Add by URL
            </Button>

            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={SUBTITLE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadFile(file)
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 size-3.5" />
              {uploading ? "Uploading…" : "Upload file (.vtt, .srt, .ass, .ssa)"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
