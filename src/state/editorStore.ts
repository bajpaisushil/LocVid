import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import type { AssetMeta, Project } from '@/core/types'

/**
 * Centralized editor state. The project document is immutable (updated through
 * immer), so undo/redo are just stacks of previous project snapshots that share
 * unchanged structure. Selection, playback and asset previews are kept outside
 * the history: undo only ever affects the document.
 */

export type Selection =
  | { kind: 'none' }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'overlay'; sceneId: string; overlayId: string }
  | { kind: 'audio'; trackId: string }

export interface AssetEntry {
  meta: AssetMeta
  /** Object URL for the stored thumbnail, owned by the store (revoked on close). */
  thumbnailUrl: string | null
}

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export interface ApplyOptions {
  /**
   * Consecutive edits with the same key within COALESCE_MS merge into one
   * undo step (e.g. dragging a slider, typing in a text field).
   */
  coalesce?: string
  select?: Selection
}

const HISTORY_LIMIT = 200
const COALESCE_MS = 1200

interface EditorState {
  project: Project | null
  assets: Record<string, AssetEntry>
  selection: Selection
  past: Project[]
  future: Project[]
  lastCoalesce: { key: string; at: number } | null
  /** Increments on every document change; autosave compares it with savedRevision. */
  revision: number
  savedRevision: number
  saveStatus: SaveStatus
  saveError: string | null

  open(project: Project, assets: { meta: AssetMeta; thumbnail: Blob | null }[]): void
  close(): void
  apply(recipe: (draft: Draft<Project>) => void, options?: ApplyOptions): void
  undo(): void
  redo(): void
  select(selection: Selection): void
  registerAsset(meta: AssetMeta, thumbnail: Blob | null): void
  updateAssetMeta(meta: AssetMeta): void
  markSaving(): void
  markSaved(revision: number): void
  markSaveError(message: string): void
}

const NO_SELECTION: Selection = { kind: 'none' }

function revokeAll(assets: Record<string, AssetEntry>) {
  for (const entry of Object.values(assets)) {
    if (entry.thumbnailUrl) URL.revokeObjectURL(entry.thumbnailUrl)
  }
}

function thumbnailUrl(blob: Blob | null): string | null {
  return blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
}

/** Keep the selection pointing at something that still exists after undo/redo/delete. */
export function sanitizeSelection(project: Project, selection: Selection): Selection {
  switch (selection.kind) {
    case 'none':
      return selection
    case 'scene':
      return project.scenes.some((s) => s.id === selection.sceneId) ? selection : NO_SELECTION
    case 'overlay': {
      const scene = project.scenes.find((s) => s.id === selection.sceneId)
      if (!scene) return NO_SELECTION
      return scene.overlays.some((o) => o.id === selection.overlayId)
        ? selection
        : { kind: 'scene', sceneId: scene.id }
    }
    case 'audio':
      return project.audioTracks.some((t) => t.id === selection.trackId) ? selection : NO_SELECTION
  }
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  project: null,
  assets: {},
  selection: NO_SELECTION,
  past: [],
  future: [],
  lastCoalesce: null,
  revision: 0,
  savedRevision: 0,
  saveStatus: 'saved',
  saveError: null,

  open(project, assets) {
    revokeAll(get().assets)
    const entries: Record<string, AssetEntry> = {}
    for (const { meta, thumbnail } of assets) entries[meta.id] = { meta, thumbnailUrl: thumbnailUrl(thumbnail) }
    set({
      project,
      assets: entries,
      selection: project.scenes[0] ? { kind: 'scene', sceneId: project.scenes[0].id } : NO_SELECTION,
      past: [],
      future: [],
      lastCoalesce: null,
      revision: 0,
      savedRevision: 0,
      saveStatus: 'saved',
      saveError: null,
    })
  },

  close() {
    revokeAll(get().assets)
    set({ project: null, assets: {}, selection: NO_SELECTION, past: [], future: [], lastCoalesce: null })
  },

  apply(recipe, options = {}) {
    const state = get()
    const current = state.project
    if (!current) return
    const next = produce(current, recipe)
    if (next === current) {
      if (options.select) set({ selection: sanitizeSelection(current, options.select) })
      return
    }
    const now = Date.now()
    const stamped = produce(next, (d) => {
      d.updatedAt = now
    })
    const coalesce =
      options.coalesce !== undefined &&
      state.lastCoalesce?.key === options.coalesce &&
      now - state.lastCoalesce.at < COALESCE_MS
    const past = coalesce ? state.past : [...state.past, current].slice(-HISTORY_LIMIT)
    set({
      project: stamped,
      past,
      future: [],
      lastCoalesce: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
      selection: sanitizeSelection(stamped, options.select ?? state.selection),
      revision: state.revision + 1,
      saveStatus: 'pending',
    })
  },

  undo() {
    const { past, project, future, selection, revision } = get()
    if (!project || past.length === 0) return
    const previous = past[past.length - 1]!
    const restored = produce(previous, (d) => {
      d.updatedAt = Date.now()
    })
    set({
      project: restored,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      lastCoalesce: null,
      selection: sanitizeSelection(restored, selection),
      revision: revision + 1,
      saveStatus: 'pending',
    })
  },

  redo() {
    const { past, project, future, selection, revision } = get()
    if (!project || future.length === 0) return
    const [next, ...rest] = future
    const restored = produce(next!, (d) => {
      d.updatedAt = Date.now()
    })
    set({
      project: restored,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: rest,
      lastCoalesce: null,
      selection: sanitizeSelection(restored, selection),
      revision: revision + 1,
      saveStatus: 'pending',
    })
  },

  select(selection) {
    const { project } = get()
    set({ selection: project ? sanitizeSelection(project, selection) : NO_SELECTION, lastCoalesce: null })
  },

  registerAsset(meta, thumbnail) {
    const existing = get().assets[meta.id]
    if (existing) return
    set((s) => ({ assets: { ...s.assets, [meta.id]: { meta, thumbnailUrl: thumbnailUrl(thumbnail) } } }))
  },

  updateAssetMeta(meta) {
    set((s) => {
      const existing = s.assets[meta.id]
      return { assets: { ...s.assets, [meta.id]: { meta, thumbnailUrl: existing?.thumbnailUrl ?? null } } }
    })
  },

  markSaving() {
    set({ saveStatus: 'saving', saveError: null })
  },

  markSaved(revision) {
    set((s) => ({
      savedRevision: Math.max(s.savedRevision, revision),
      saveStatus: s.revision === revision ? 'saved' : 'pending',
      saveError: null,
    }))
  },

  markSaveError(message) {
    set({ saveStatus: 'error', saveError: message })
  },
}))

/** Convenience for components: the open project (throws if none — editor routes guarantee one). */
export function useProject(): Project {
  const project = useEditorStore((s) => s.project)
  if (!project) throw new Error('No project is open')
  return project
}
