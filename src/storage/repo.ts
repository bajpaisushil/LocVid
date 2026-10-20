import { parseAssetMeta, parseProject } from '@/core/schema'
import type { AssetMeta, Project } from '@/core/types'
import { DEPTH_ANALYSIS_VERSION, StorageError, withStorage, type DepthAnalysis, type StoredAsset } from './db'

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** All projects, most recently modified first. Corrupt records are skipped, not fatal. */
export async function listProjects(): Promise<Project[]> {
  const raw = await withStorage((db) => db.getAll('projects'))
  const projects: Project[] = []
  for (const record of raw) {
    try {
      projects.push(parseProject(record))
    } catch (error) {
      console.warn('Skipping unreadable project record', error)
    }
  }
  return projects.toSorted((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<Project> {
  const raw = await withStorage((db) => db.get('projects', id))
  if (!raw) throw new StorageError('not-found', 'This project no longer exists. It may have been deleted in another tab.')
  return parseProject(raw)
}

export async function saveProject(project: Project): Promise<void> {
  await withStorage((db) => db.put('projects', project))
}

export async function renameProject(id: string, name: string): Promise<Project> {
  return withStorage(async (db) => {
    const tx = db.transaction('projects', 'readwrite')
    const raw = await tx.store.get(id)
    if (!raw) throw new StorageError('not-found', 'Project not found.')
    const project = { ...parseProject(raw), name: name.trim() || 'Untitled project', updatedAt: Date.now() }
    await tx.store.put(project)
    await tx.done
    return project
  })
}

/** Delete a project, its poster, and any media no other project uses. */
export async function deleteProject(id: string): Promise<void> {
  await withStorage(async (db) => {
    const tx = db.transaction(['projects', 'posters'], 'readwrite')
    await tx.objectStore('projects').delete(id)
    await tx.objectStore('posters').delete(id)
    await tx.done
  })
  await collectGarbage()
}

export async function savePoster(projectId: string, poster: Blob): Promise<void> {
  await withStorage((db) => db.put('posters', poster, projectId))
}

export async function getPoster(projectId: string): Promise<Blob | undefined> {
  return withStorage((db) => db.get('posters', projectId))
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** Store a new asset (metadata + original file + thumbnail) atomically. */
export async function putAsset(meta: AssetMeta, blob: Blob, thumbnail: Blob | null): Promise<void> {
  await withStorage(async (db) => {
    const tx = db.transaction(['assets', 'blobs'], 'readwrite')
    await tx.objectStore('blobs').put(blob, meta.id)
    await tx.objectStore('assets').put({ meta, thumbnail })
    await tx.done
  })
}

export async function findAssetByFingerprint(fingerprint: string): Promise<StoredAsset | undefined> {
  if (!fingerprint) return undefined
  return withStorage((db) => db.getFromIndex('assets', 'by-fingerprint', fingerprint))
}

export async function getAssets(ids: readonly string[]): Promise<StoredAsset[]> {
  return withStorage(async (db) => {
    const tx = db.transaction('assets', 'readonly')
    const records = await Promise.all(ids.map((assetId) => tx.store.get(assetId)))
    await tx.done
    const out: StoredAsset[] = []
    for (const record of records) {
      if (!record) continue
      try {
        out.push({ meta: parseAssetMeta(record.meta), thumbnail: record.thumbnail ?? null })
      } catch (error) {
        console.warn('Skipping unreadable asset record', error)
      }
    }
    return out
  })
}

export async function listAllAssets(): Promise<StoredAsset[]> {
  return withStorage((db) => db.getAll('assets'))
}

export async function getAssetBlob(id: string): Promise<Blob> {
  const blob = await withStorage((db) => db.get('blobs', id))
  if (!blob) throw new StorageError('not-found', 'The media file for this asset is missing from local storage.')
  return blob
}

export async function hasAssetBlob(id: string): Promise<boolean> {
  return withStorage(async (db) => (await db.getKey('blobs', id)) !== undefined)
}

export async function updateAssetMeta(meta: AssetMeta): Promise<void> {
  await withStorage(async (db) => {
    const tx = db.transaction('assets', 'readwrite')
    const existing = await tx.store.get(meta.id)
    await tx.store.put({ meta, thumbnail: existing?.thumbnail ?? null })
    await tx.done
  })
}

/**
 * Delete every asset that no project references. Runs when the home screen
 * opens and after project deletion (never while an editor might still undo
 * an asset removal in the same session).
 */
export async function collectGarbage(): Promise<{ removed: number; freedBytes: number }> {
  return withStorage(async (db) => {
    const tx = db.transaction(['projects', 'assets', 'blobs', 'analysis'], 'readwrite')
    const projects = await tx.objectStore('projects').getAll()
    const referenced = new Set<string>()
    for (const p of projects) {
      for (const assetId of p.assetIds ?? []) referenced.add(assetId)
    }
    let removed = 0
    let freedBytes = 0
    const assetStore = tx.objectStore('assets')
    const blobStore = tx.objectStore('blobs')
    for (const record of await assetStore.getAll()) {
      if (referenced.has(record.meta.id)) continue
      freedBytes += record.meta.size ?? 0
      removed += 1
      await assetStore.delete(record.meta.id)
      await blobStore.delete(record.meta.id)
      await tx.objectStore('analysis').delete(record.meta.id)
    }
    // Orphaned blobs without metadata (e.g. an interrupted import).
    for (const key of await blobStore.getAllKeys()) {
      if (!referenced.has(key) && !(await assetStore.getKey(key))) await blobStore.delete(key)
    }
    await tx.done
    return { removed, freedBytes }
  })
}

// ---------------------------------------------------------------------------
// Vision analysis (depth maps)
// ---------------------------------------------------------------------------

export async function putAnalysis(record: DepthAnalysis): Promise<void> {
  await withStorage((db) => db.put('analysis', record))
}

export async function getAnalyses(assetIds: readonly string[]): Promise<Map<string, DepthAnalysis>> {
  return withStorage(async (db) => {
    const tx = db.transaction('analysis', 'readonly')
    const rows = await Promise.all(assetIds.map((id) => tx.store.get(id)))
    await tx.done
    const out = new Map<string, DepthAnalysis>()
    // Records in an older format are ignored (and recomputed on demand).
    for (const row of rows) if (row && row.version === DEPTH_ANALYSIS_VERSION) out.set(row.assetId, row)
    return out
  })
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await withStorage((db) => db.get('kv', key))
    return value === undefined ? fallback : (value as T)
  } catch {
    return fallback
  }
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  await withStorage((db) => db.put('kv', value, key))
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface StorageInfo {
  usage: number | null
  quota: number | null
  persisted: boolean | null
  canPersist: boolean
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  const info: StorageInfo = { usage: null, quota: null, persisted: null, canPersist: !!storage?.persist }
  try {
    if (storage?.estimate) {
      const estimate = await storage.estimate()
      info.usage = estimate.usage ?? null
      info.quota = estimate.quota ?? null
    }
    if (storage?.persisted) info.persisted = await storage.persisted()
  } catch {
    // Some browsers throw in private mode; report unknown.
  }
  return info
}

/** Ask the browser not to evict our data under storage pressure. Returns whether it agreed. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
