import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AssetMeta, Project } from '@/core/types'

/**
 * IndexedDB layout
 * ----------------
 *  projects  – project metadata JSON (small; scenes reference assets by ID)
 *  assets    – asset metadata + a small JPEG thumbnail
 *  blobs     – the original media files, keyed by asset ID (large, never inlined in projects)
 *  posters   – a small rendered preview frame per project for the home screen
 *  analysis  – per-image results of on-device vision models (depth maps), computed once
 *  kv        – app preferences (e.g. which optional AI models were downloaded)
 *
 * Nothing here is encrypted, and it lives only in this browser profile:
 * clearing site data removes it.
 */

export interface StoredAsset {
  meta: AssetMeta
  thumbnail: Blob | null
}

/** Depth analysis of an image asset (from Depth Anything V2, on device). */
export interface DepthAnalysis {
  assetId: string
  width: number
  height: number
  /** Normalized disparity, row-major Uint16 (65535 = nearest). */
  depth: ArrayBuffer
  /** Uint8 mask: 1 where the far region connected to the top edge (sky / distance). */
  far: ArrayBuffer
  /** Typical disparity (0..1) of the main subject, used as the camera's pivot. */
  subject: number
  /** Normalized [x, y, w, h] of the main subject, for framing close-ups. */
  subjectBox: [number, number, number, number]
  /** Background layer behind foreground edges (revealed when the camera moves): RGBA8 color… */
  fill: ArrayBuffer
  /** …its depth (Uint16)… */
  bgDepth: ArrayBuffer
  /** …and where it differs from the original (Uint8). */
  hole: ArrayBuffer
  /** Bumped when the analysis format changes; older records are recomputed. */
  version: number
  model: string
  createdAt: number
  /** Subject cut-out for subject animation: absent = not analyzed yet, null = no clear subject. */
  cutout?: SubjectCutout | null
}

export const DEPTH_ANALYSIS_VERSION = 4

/** One separately moving subject in a picture. */
export interface CutoutActor {
  /** Normalized [x, y, w, h]. */
  box: [number, number, number, number]
  /** Normalized ground-contact point (bottom center). */
  anchor: [number, number]
  /** Value of this actor in the label map (1-based). */
  label: number
  /** Fraction of the picture covered. */
  area: number
  /** Touches an edge of the picture (a cut-off body must not move away from that edge). */
  edges: { left: boolean; right: boolean; top: boolean; bottom: boolean }
  /**
   * Disparity the actor is drawn at: the ground's where it stands (so its feet
   * don't slide over the ground when the camera moves), else its body's.
   */
  depth: number
}

/**
 * The picture's subject(s) separated from the background (IS-Net matte) plus a
 * "clean plate" with them painted out (MI-GAN), so subjects can move on their
 * own over plausible scenery. Maps are at `width`×`height` (the analyzed
 * picture); the plate's depth layers are at the depth map's size and scale.
 */
export interface SubjectCutout {
  version: number
  model: string
  width: number
  height: number
  /** Uint8 soft alpha of the actors. */
  matte: ArrayBuffer
  /** Uint8 actor label per pixel (0 = background). */
  labels: ArrayBuffer
  /** RGBA8 picture with the actors painted out. */
  plate: ArrayBuffer
  /** Uint8 0..255 — where the plate replaces the original (feathered). */
  plateMask: ArrayBuffer
  actors: CutoutActor[]
  /** Disparity (0..1) of the actors on the original depth scale. */
  disparity: number
  plateDepth: ArrayBuffer
  plateFar: ArrayBuffer
  plateFill: ArrayBuffer
  plateBgDepth: ArrayBuffer
  plateHole: ArrayBuffer
}

export const CUTOUT_VERSION = 3

export interface LocVidDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { 'by-updated': number } }
  assets: { key: string; value: StoredAsset; indexes: { 'by-fingerprint': string } }
  blobs: { key: string; value: Blob }
  posters: { key: string; value: Blob }
  kv: { key: string; value: unknown }
  analysis: { key: string; value: DepthAnalysis }
}

export const DB_NAME = 'locvid'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<LocVidDB>> | null = null

export class StorageError extends Error {
  readonly code: 'quota' | 'unavailable' | 'not-found' | 'unknown'
  constructor(code: StorageError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}

/** Translate raw IndexedDB/DOM exceptions into messages a user can act on. */
export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'QuotaExceededError' || /quota/i.test(String((error as Error)?.message ?? ''))) {
    return new StorageError(
      'quota',
      'Browser storage is full. Delete unused projects or media, or allow persistent storage, then try again.',
      { cause: error },
    )
  }
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError') {
    return new StorageError(
      'unavailable',
      'Local storage is unavailable in this browser window (private browsing or blocked site data can cause this). Projects cannot be saved.',
      { cause: error },
    )
  }
  return new StorageError('unknown', `Storage error: ${(error as Error)?.message ?? String(error)}`, { cause: error })
}

export function getDB(): Promise<IDBPDatabase<LocVidDB>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable', 'This browser does not support IndexedDB.'))
    }
    dbPromise = openDB<LocVidDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' })
          projects.createIndex('by-updated', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('assets')) {
          const assets = db.createObjectStore('assets', { keyPath: 'meta.id' })
          assets.createIndex('by-fingerprint', 'meta.fingerprint')
        }
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('posters')) db.createObjectStore('posters')
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
        // v2: depth analysis results.
        if (!db.objectStoreNames.contains('analysis')) db.createObjectStore('analysis', { keyPath: 'assetId' })
      },
      blocking() {
        // Another tab wants a newer schema: close so it can upgrade.
        void dbPromise?.then((db) => db.close())
        dbPromise = null
      },
      terminated() {
        dbPromise = null
      },
    }).catch((error: unknown) => {
      dbPromise = null
      throw toStorageError(error)
    })
  }
  return dbPromise
}

/** For tests: drop the cached connection so a fresh database can be opened. */
export async function resetDBConnection(): Promise<void> {
  const pending = dbPromise
  dbPromise = null
  if (pending) {
    try {
      ;(await pending).close()
    } catch {
      // already closed
    }
  }
}

export async function withStorage<T>(fn: (db: IDBPDatabase<LocVidDB>) => Promise<T>): Promise<T> {
  try {
    return await fn(await getDB())
  } catch (error) {
    throw toStorageError(error)
  }
}
