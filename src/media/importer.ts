import type { AssetKind, AssetMeta } from '@/core/types'
import { createId } from '@/lib/id'
import { errorMessage } from '@/lib/errors'
import { findAssetByFingerprint, putAsset } from '@/storage/repo'
import { guessMime, MediaImportError, validateFile } from './detect'
import { fingerprintFile } from './fingerprint'
import { probeAudio, probeImage, probeVideo, type ProbeResult } from './probe'

export interface ImportedAsset {
  meta: AssetMeta
  thumbnail: Blob | null
  /** True when an identical file was already stored and has been reused. */
  reused: boolean
}

export interface ImportFailure {
  fileName: string
  message: string
}

export interface ImportProgress {
  index: number
  total: number
  fileName: string
}

const PROBES: Record<AssetKind, (file: File) => Promise<ProbeResult>> = {
  image: probeImage,
  video: probeVideo,
  audio: probeAudio,
}

export interface ImportOptions {
  origin?: AssetMeta['origin']
  generator?: AssetMeta['generator']
}

/**
 * Validate, probe and store one file. Identical content that is already in
 * local storage is reused instead of being stored again.
 */
export async function importFile(file: File, options: ImportOptions = {}): Promise<ImportedAsset> {
  const kind = validateFile(file)
  const fingerprint = await fingerprintFile(file)
  const existing = await findAssetByFingerprint(fingerprint)
  if (existing) return { meta: existing.meta, thumbnail: existing.thumbnail, reused: true }

  const probe = await PROBES[kind](file)
  const meta: AssetMeta = {
    id: createId('ast'),
    kind,
    name: file.name || `Untitled ${kind}`,
    mimeType: probe.stored === file ? guessMime(file) : probe.stored.type || guessMime(file),
    size: probe.stored.size,
    width: probe.width,
    height: probe.height,
    duration: probe.duration,
    hasAudio: probe.hasAudio,
    fingerprint,
    origin: options.origin ?? 'import',
    generator: options.generator,
    original: probe.original,
    createdAt: Date.now(),
  }
  await putAsset(meta, probe.stored, probe.thumbnail)
  return { meta, thumbnail: probe.thumbnail, reused: false }
}

/** Import files one at a time (bounded memory), collecting per-file failures instead of stopping. */
export async function importFiles(
  files: readonly File[],
  onProgress?: (progress: ImportProgress) => void,
  onImported?: (asset: ImportedAsset) => void,
  options: ImportOptions = {},
): Promise<{ imported: ImportedAsset[]; failed: ImportFailure[] }> {
  const imported: ImportedAsset[] = []
  const failed: ImportFailure[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    onProgress?.({ index: i, total: files.length, fileName: file.name })
    try {
      const asset = await importFile(file, options)
      imported.push(asset)
      onImported?.(asset)
    } catch (error) {
      failed.push({
        fileName: file.name,
        message: error instanceof MediaImportError ? error.message : errorMessage(error),
      })
    }
  }
  return { imported, failed }
}
