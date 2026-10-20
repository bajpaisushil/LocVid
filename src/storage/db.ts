import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AssetMeta, Project } from '@/core/types'

/**
 * IndexedDB layout
 * ----------------
 *  projects  – project metadata JSON (small; scenes reference assets by ID)
 *  assets    – asset metadata + a small JPEG thumbnail
 *  blobs     – the original media files, keyed by asset ID (large, never inlined in projects)
 *  posters   – a small rendered preview frame per project for the home screen
 *  kv        – app preferences (e.g. which optional AI models were downloaded)
 *
 * Nothing here is encrypted, and it lives only in this browser profile:
 * clearing site data removes it.
 */

export interface StoredAsset {
  meta: AssetMeta
  thumbnail: Blob | null
}

export interface LocVidDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { 'by-updated': number } }
  assets: { key: string; value: StoredAsset; indexes: { 'by-fingerprint': string } }
  blobs: { key: string; value: Blob }
  posters: { key: string; value: Blob }
  kv: { key: string; value: unknown }
}

export const DB_NAME = 'locvid'
const DB_VERSION = 1

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
