import { appendActionLog } from "@/server/log"
import { resolveMediaSource } from "@/server/media/resolve"
import {
  canControlFromConnectionContext,
} from "@/server/realtime/services/permissions"
import {
  playlistAddUrlSchema,
  playlistAddLocalSchema,
  playlistItemErrorSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistStreamSelectSchema,
  playlistTextTrackSelectSchema,
  playlistTextTrackAddSchema,
} from "@/zod/schemas"
import type { RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

function nextMonotonicMs(previous: number, next: number) {
  return Math.max(previous + 1, next)
}

export const handlePlaylistAdd: RoomMessageHandler = async (ctx, data) => {
  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }
      const item = data.payload.item as RoomState["playlist"][number]
      state.playlist.push(item)
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:add",
        payload: {
          itemId: item.id,
          itemName: item.name,
          index: state.playlist.length - 1,
        },
      })
      return true
    },
  )
}

export const handlePlaylistSelect: RoomMessageHandler = async (ctx, data) => {
  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }
      const nextIndex = Number(data.payload.index ?? -1)
      if (
        Number.isInteger(nextIndex) &&
        nextIndex >= 0 &&
        nextIndex < state.playlist.length
      ) {
        state.currentIndex = nextIndex
        state.playback.timelineAnchorMs = 0
        state.playback.serverNowMs = nextMonotonicMs(
          state.playback.serverNowMs,
          Date.now(),
        )
        state.playback.paused = true
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "media:played",
          payload: {
            index: nextIndex,
            mediaName: state.playlist[nextIndex]?.name,
            mediaId: state.playlist[nextIndex]?.id,
          },
        })
      }
      return true
    },
  )
}

export const handlePlaylistAddUrl: RoomMessageHandler = async (ctx, data) => {
  const addUrlResult = playlistAddUrlSchema.safeParse(data.payload)
  if (!addUrlResult.success) return

  const queuedItemId = randomUUID()
  const sourceUrl = addUrlResult.data.url
  let shouldResolve = false

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }

      shouldResolve = true
      state.playlist.push({
        id: queuedItemId,
        name: sourceUrl,
        sourceKind: "remote_url",
        playbackMode: "direct",
        sourceUrl,
        playableUrl: sourceUrl,
        ingestStatus: "resolving",
        isResolving: true,
        createdBy: ctx.userId,
        createdAt: Date.now(),
      })
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:add",
        payload: {
          itemId: queuedItemId,
          itemName: sourceUrl,
          index: state.playlist.length - 1,
          pending: true,
        },
      })
      return true
    },
  )

  if (!shouldResolve) {
    return
  }

  try {
    const resolved = await resolveMediaSource({ url: sourceUrl })
    await ctx.store.updateRoom(ctx.roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === queuedItemId)
      if (!item) return null
      item.playableUrl = resolved.playableUrl
      item.playbackMode = resolved.playbackMode
      item.mediaStreams = resolved.mediaStreams
      item.selectedStreamId = resolved.selectedStreamId
      item.textTracks = resolved.textTracks
      item.selectedTextTrackId = resolved.selectedTextTrackId
      item.durationSeconds = resolved.durationSeconds ?? undefined
      item.ingestStatus = "ready"
      item.isResolving = false
      item.ingestError = undefined
      item.resolutionError = undefined
      if (item.name.trim() === item.sourceUrl.trim()) {
        item.name = resolved.title || item.sourceUrl
      }
      state.updatedAt = Date.now()
      return state
    })
  } catch {
    await ctx.store.updateRoom(ctx.roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === queuedItemId)
      if (!item) return null
      item.isResolving = false
      item.ingestStatus = "error"
      item.ingestError = "Failed to resolve metadata"
      item.resolutionError = "Failed to resolve metadata"
      state.updatedAt = Date.now()
      return state
    })
  }
}

export const handlePlaylistAddLocal: RoomMessageHandler = async (ctx, data) => {
  const parsed = playlistAddLocalSchema.safeParse(data.payload)
  if (!parsed.success) return

  const itemId = randomUUID()
  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state, participant) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }
    const playableUrl = `/api/media/local/${encodeURIComponent(parsed.data.localMediaId)}`
    state.playlist.push({
      id: itemId,
      name: parsed.data.name,
      sourceKind: "local_file",
      playbackMode: "relay",
      sourceUrl: playableUrl,
      playableUrl,
      ingestStatus: "ready",
      mediaStreams: [
        {
          id: "local-default",
          src: playableUrl,
          type: parsed.data.mimeType,
          isDefault: true,
          label: "Local",
        },
      ],
      localMediaId: parsed.data.localMediaId,
      localOriginUserId: ctx.userId,
      createdBy: ctx.userId,
      createdAt: Date.now(),
    })
    appendActionLog(state, {
      roomId: ctx.roomId,
      actorUserId: ctx.userId,
      actorUsername: participant.username,
      action: "playlist:add",
      payload: {
        itemId,
        itemName: parsed.data.name,
        index: state.playlist.length - 1,
        sourceKind: "local_file",
      },
    })
    return true
  })
}

export const handlePlaylistRetry: RoomMessageHandler = async (ctx, data) => {
  const parsed = playlistRetrySchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }
    const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
    if (!item) return false
    if (item.blockedReason === "local_owner_offline") {
      return false
    }
    item.ingestStatus = "ready"
    item.ingestError = undefined
    item.resolutionError = undefined
    item.isResolving = false
    return true
  })
}

export const handlePlaylistItemError: RoomMessageHandler = async (ctx, data) => {
  const parsed = playlistItemErrorSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state, participant) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }

    const index = state.playlist.findIndex((entry) => entry.id === parsed.data.itemId)
    if (index < 0) return false
    const item = state.playlist[index]
    if (!item) return false
    item.ingestStatus = "error"
    item.ingestError = parsed.data.error
    item.resolutionError = parsed.data.error

    if (state.currentIndex === index && state.playlist.length > 1) {
      const nextIndex = Math.min(state.playlist.length - 1, index + 1)
      if (nextIndex !== index) {
        state.currentIndex = nextIndex
        state.playback.timelineAnchorMs = 0
        state.playback.serverNowMs = nextMonotonicMs(
          state.playback.serverNowMs,
          Date.now(),
        )
        state.playback.paused = true
      }
    }
    appendActionLog(state, {
      roomId: ctx.roomId,
      actorUserId: ctx.userId,
      actorUsername: participant.username,
      action: "participant:error",
      payload: {
        itemId: item.id,
        mediaName: item.name,
      },
      error: parsed.data.error,
    })
    return true
  })
}

export const handlePlaylistStreamSelect: RoomMessageHandler = async (ctx, data) => {
  const parsed = playlistStreamSelectSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }
    const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
    if (!item) return false
    const stream = item.mediaStreams?.find(
      (entry) => entry.id === parsed.data.streamId,
    )
    if (!stream) return false
    item.selectedStreamId = stream.id
    item.playableUrl = stream.src
    state.updatedAt = Date.now()
    return true
  })
}

export const handlePlaylistTextTrackSelect: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = playlistTextTrackSelectSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }
    const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
    if (!item) return false
    if (
      parsed.data.textTrackId !== null &&
      !item.textTracks?.some((entry) => entry.id === parsed.data.textTrackId)
    ) {
      return false
    }
    item.selectedTextTrackId = parsed.data.textTrackId ?? undefined
    state.updatedAt = Date.now()
    return true
  })
}

export const handlePlaylistTextTrackAdd: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = playlistTextTrackAddSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
      })
    ) {
      return false
    }
    const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
    if (!item) return false
    const trackId = randomUUID()
    const newTrack = {
      id: trackId,
      src: parsed.data.src,
      label: parsed.data.label,
      language: parsed.data.language,
      kind: parsed.data.kind ?? "subtitles",
      type: parsed.data.type,
      isDefault: false,
    }
    item.textTracks = [...(item.textTracks ?? []), newTrack]
    state.updatedAt = Date.now()
    return true
  })
}

  const reorderResult = playlistReorderSchema.safeParse(data.payload)
  if (!reorderResult.success) return

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }
      const { from, to } = reorderResult.data
      if (
        from >= 0 &&
        to >= 0 &&
        from < state.playlist.length &&
        to < state.playlist.length
      ) {
        const currentMediaId = state.playlist[state.currentIndex]?.id
        const [entry] = state.playlist.splice(from, 1)
        if (entry) state.playlist.splice(to, 0, entry)
        if (entry) {
          appendActionLog(state, {
            roomId: ctx.roomId,
            actorUserId: ctx.userId,
            actorUsername: participant.username,
            action: "playlist:reorder",
            payload: {
              itemId: entry.id,
              itemName: entry.name,
              from,
              to,
            },
          })
        }
        if (currentMediaId) {
          const nextCurrentIndex = state.playlist.findIndex(
            (item) => item.id === currentMediaId,
          )
          if (nextCurrentIndex >= 0) state.currentIndex = nextCurrentIndex
        }
      }
      return true
    },
  )
}

export const handlePlaylistRename: RoomMessageHandler = async (ctx, data) => {
  const renameResult = playlistRenameSchema.safeParse(data.payload)
  if (!renameResult.success) return

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }
      const item = state.playlist.find(
        (entry) => entry.id === renameResult.data.itemId,
      )
      if (!item) {
        return false
      }
      const nextName = renameResult.data.name.trim()
      if (!nextName || nextName === item.name) {
        return false
      }
      const previousName = item.name
      item.name = nextName
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:rename",
        payload: {
          itemId: item.id,
          previousName,
          nextName,
        },
      })
      return true
    },
  )
}

export const handlePlaylistImport: RoomMessageHandler = async (ctx, data) => {
  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
        })
      ) {
        return false
      }
      const mode = String(data.payload.mode ?? "append")
      const items = (data.payload.items as RoomState["playlist"]) ?? []
      state.playlist =
        mode === "override" ? items : [...state.playlist, ...items]
      if (state.currentIndex >= state.playlist.length) {
        state.currentIndex = Math.max(0, state.playlist.length - 1)
      }
      return true
    },
  )
}
