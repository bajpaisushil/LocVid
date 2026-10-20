import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, createScene } from '@/core/defaults'
import type { AssetMeta } from '@/core/types'
import { resetDBConnection, StorageError, toStorageError } from './db'
import {
  collectGarbage,
  deleteProject,
  findAssetByFingerprint,
  getAssetBlob,
  getAssets,
  getProject,
  listProjects,
  putAsset,
  renameProject,
  saveProject,
} from './repo'

function asset(id: string, fingerprint = `fp-${id}`): AssetMeta {
  return {
    id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    size: 4,
    width: 10,
    height: 10,
    fingerprint,
    origin: 'import',
    createdAt: 1,
  }
}

beforeEach(async () => {
  await resetDBConnection()
  globalThis.indexedDB = new IDBFactory()
})

describe('project repository', () => {
  it('saves and reopens projects, newest first', async () => {
    const older = createProject({ name: 'Older', now: 1000 })
    const newer = createProject({ name: 'Newer', now: 2000 })
    newer.scenes = [createScene({ index: 0 }), createScene({ index: 1, duration: 2 })]
    await saveProject(older)
    await saveProject(newer)

    const list = await listProjects()
    expect(list.map((p) => p.name)).toEqual(['Newer', 'Older'])

    const reopened = await getProject(newer.id)
    expect(reopened).toEqual(newer)
    expect(reopened.scenes.map((s) => s.duration)).toEqual([5, 2])
  })

  it('reports a missing project clearly', async () => {
    await expect(getProject('nope')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('renames a project and bumps its modified time', async () => {
    const p = createProject({ name: 'Draft', now: 1000 })
    await saveProject(p)
    const renamed = await renameProject(p.id, '  Final cut  ')
    expect(renamed.name).toBe('Final cut')
    expect(renamed.updatedAt).toBeGreaterThan(1000)
    expect((await getProject(p.id)).name).toBe('Final cut')
  })

  it('skips corrupt records instead of failing the whole list', async () => {
    const good = createProject({ name: 'Good' })
    await saveProject(good)
    await saveProject({ ...createProject(), scenes: 'broken' } as never)
    const list = await listProjects()
    expect(list.map((p) => p.name)).toEqual(['Good'])
  })
})

describe('asset repository', () => {
  it('stores metadata and the original file separately', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    await putAsset(asset('ast_a'), blob, null)
    const [stored] = await getAssets(['ast_a', 'missing'])
    expect(stored?.meta.name).toBe('ast_a.png')
    const restored = await getAssetBlob('ast_a')
    expect(restored.size).toBe(4)
  })

  it('finds duplicates by fingerprint', async () => {
    await putAsset(asset('ast_a', 'same-content'), new Blob(['x']), null)
    expect((await findAssetByFingerprint('same-content'))?.meta.id).toBe('ast_a')
    expect(await findAssetByFingerprint('other')).toBeUndefined()
  })

  it('garbage-collects media no project references', async () => {
    const p1 = createProject({ name: 'One' })
    const p2 = createProject({ name: 'Two' })
    p1.assetIds = ['shared', 'only1']
    p2.assetIds = ['shared']
    await saveProject(p1)
    await saveProject(p2)
    for (const id of ['shared', 'only1', 'orphan']) await putAsset(asset(id), new Blob(['data']), null)

    const first = await collectGarbage()
    expect(first.removed).toBe(1) // orphan
    await deleteProject(p1.id)

    const remaining = await getAssets(['shared', 'only1', 'orphan'])
    expect(remaining.map((a) => a.meta.id)).toEqual(['shared'])
    await expect(getAssetBlob('only1')).rejects.toBeInstanceOf(StorageError)
  })
})

describe('storage errors', () => {
  it('maps quota errors to an actionable message', () => {
    const err = toStorageError(new DOMException('full', 'QuotaExceededError'))
    expect(err.code).toBe('quota')
    expect(err.message).toMatch(/storage is full/i)
  })
})
