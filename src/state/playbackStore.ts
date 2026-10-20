import { create } from 'zustand'

/**
 * Playback position, kept separate from the document store so 60 fps time
 * updates only re-render the few components that display time.
 */
interface PlaybackState {
  time: number
  playing: boolean
  /** Bumped on explicit seeks so the player can resync media elements. */
  seekToken: number
  seek(time: number): void
  setTime(time: number): void
  play(): void
  pause(): void
  toggle(): void
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  time: 0,
  playing: false,
  seekToken: 0,
  seek(time) {
    set({ time: Math.max(0, time), seekToken: get().seekToken + 1 })
  },
  setTime(time) {
    set({ time })
  },
  play() {
    set({ playing: true })
  },
  pause() {
    set({ playing: false })
  },
  toggle() {
    set({ playing: !get().playing })
  },
}))
