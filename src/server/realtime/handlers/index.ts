import * as participant from "./participant"
import * as playback from "./playback"
import * as playlist from "./playlist"
import * as roomPassword from "./room-password"
import * as seekPreview from "./seek-preview"
import type { RoomMessageHandler } from "./types"

export const roomMessageHandlers: Record<string, RoomMessageHandler> = {
  "playback:seek": playback.handlePlaybackSeek,
  "playback:play": playback.handlePlaybackPlay,
  "playback:pause": playback.handlePlaybackPause,
  "playback:rate": playback.handlePlaybackRate,
  "playback:loop:video": playback.handlePlaybackLoopVideo,
  "playback:loop:playlist": playback.handlePlaybackLoopPlaylist,
  "playlist:add": playlist.handlePlaylistAdd,
  "playlist:add:url": playlist.handlePlaylistAddUrl,
  "playlist:add:local": playlist.handlePlaylistAddLocal,
  "playlist:select": playlist.handlePlaylistSelect,
  "playlist:reorder": playlist.handlePlaylistReorder,
  "playlist:rename": playlist.handlePlaylistRename,
  "playlist:retry": playlist.handlePlaylistRetry,
  "playlist:item:error": playlist.handlePlaylistItemError,
  "playlist:stream:select": playlist.handlePlaylistStreamSelect,
  "playlist:text-track:select": playlist.handlePlaylistTextTrackSelect,
  "playlist:text-track:add": playlist.handlePlaylistTextTrackAdd,
  "playlist:import": playlist.handlePlaylistImport,
  "seek:preview": seekPreview.handleSeekPreview,
  "participant:update": participant.handleParticipantUpdate,
  "participant:role:update": participant.handleParticipantRoleUpdate,
  "room:password:set": roomPassword.handleRoomPasswordSet,
  "room:password:clear": roomPassword.handleRoomPasswordClear,
}
