import { z } from 'zod'
import { parseAssetMeta, parseProject, ProjectValidationError } from '@/core/schema'
import type { AssetMeta, Project } from '@/core/types'
import { createId } from '@/lib/id'
import { findAssetByFingerprint, getAssets, getProject, saveProject } from '@/storage/repo'

/**
 * Project files (.locvid.json) contain the project document and the metadata of
 * the media it uses — not the media itself. They are for backups, moving a
 * project between browsers, and inspecting exactly what is stored.
 */

export const PROJECT_FILE_FORMAT = 'locvid-project'

const fileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  formatVersion: z.literal(1),
  project: z.unknown(),
  assets: z.array(z.unknown()).max(5000).catch([]),
})

export async function buildProjectFile(projectId: string): Promise<Blob> {
  const project = await getProject(projectId)
  const assets = (await getAssets(project.assetIds)).map((a) => a.meta)
  const payload = {
    format: PROJECT_FILE_FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    note: 'LocVid project metadata. Media files are not included; they stay in the browser that created this project.',
    project,
    assets,
  }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}

export interface ImportResult {
  project: Project
  /** Media referenced by the project that is not in this browser's storage. */
  missingMedia: number
}

const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024

export async function importProjectFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectValidationError('This file is too large to be a LocVid project file.')
  }
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new ProjectValidationError('This file is not valid JSON, so it cannot be a LocVid project file.')
  }
  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) {
    throw new ProjectValidationError('This JSON file is not a LocVid project file.')
  }
  const project = parseProject(parsed.data.project)
  const assets: AssetMeta[] = []
  for (const raw of parsed.data.assets) {
    try {
      assets.push(parseAssetMeta(raw))
    } catch {
      // ignore unreadable asset entries; their references will show as missing media
    }
  }

  // Re-link references to media already stored in this browser (same ID or same content fingerprint).
  const local = new Set((await getAssets(project.assetIds)).map((a) => a.meta.id))
  const remap = new Map<string, string>()
  for (const meta of assets) {
    if (local.has(meta.id)) continue
    const match = await findAssetByFingerprint(meta.fingerprint)
    if (match) remap.set(meta.id, match.meta.id)
  }
  const relinked = remapAssetIds(project, remap)
  const resolved = new Set((await getAssets(relinked.assetIds)).map((a) => a.meta.id))
  const missingMedia = relinked.assetIds.filter((id) => !resolved.has(id)).length

  const now = Date.now()
  const imported: Project = { ...relinked, id: createId('prj'), createdAt: now, updatedAt: now }
  await saveProject(imported)
  return { project: imported, missingMedia }
}

export function remapAssetIds(project: Project, remap: Map<string, string>): Project {
  if (remap.size === 0) return project
  const map = (id: string) => remap.get(id) ?? id
  return {
    ...project,
    assetIds: [...new Set(project.assetIds.map(map))],
    scenes: project.scenes.map((s) => ({
      ...s,
      background: s.background.kind === 'media' ? { ...s.background, assetId: map(s.background.assetId) } : s.background,
      audio: s.audio ? { ...s.audio, assetId: map(s.audio.assetId) } : null,
    })),
    audioTracks: project.audioTracks.map((t) => ({ ...t, assetId: map(t.assetId) })),
    brand: { ...project.brand, logoAssetId: project.brand.logoAssetId ? map(project.brand.logoAssetId) : null },
  }
}

/** Copy a project. Media is shared by reference, never duplicated. */
export async function duplicateProject(projectId: string): Promise<Project> {
  const original = await getProject(projectId)
  const now = Date.now()
  const copy: Project = {
    ...structuredClone(original),
    id: createId('prj'),
    name: `${original.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  }
  await saveProject(copy)
  return copy
}
