import type { AssetMeta } from '@/core/types'
import type { SourceImage } from '@/render/types'
import { getAssetBlob } from '@/storage/repo'

/** Longest side of decoded preview images; the preview canvas is never larger than 1280 px. */
const PREVIEW_IMAGE_SIDE = 1920
/** Rough budget for decoded preview bitmaps (RGBA bytes). */
const IMAGE_BUDGET_BYTES = 320 * 1024 * 1024

interface ImageEntry {
  image: SourceImage | null
  bytes: number
  lastUsed: number
  failed: boolean
}

/**
 * Preview-side media access: object URLs for <video>/<audio>, decoded and
 * downsized ImageBitmaps (LRU within a memory budget) and decoded audio
 * buffers. Everything is released in `dispose()`.
 */
export class PreviewMediaCache {
  private urls = new Map<string, Promise<string>>()
  private resolvedUrls: string[] = []
  private images = new Map<string, ImageEntry>()
  private pendingImages = new Set<string>()
  private audio = new Map<string, Promise<AudioBuffer | null>>()
  private disposed = false
  /** Called when something new becomes drawable. */
  onReady: () => void = () => {}

  objectUrl(assetId: string): Promise<string> {
    let url = this.urls.get(assetId)
    if (!url) {
      url = getAssetBlob(assetId).then((blob) => {
        const u = URL.createObjectURL(blob)
        if (this.disposed) URL.revokeObjectURL(u)
        else this.resolvedUrls.push(u)
        return u
      })
      url.catch(() => this.urls.delete(assetId))
      this.urls.set(assetId, url)
    }
    return url
  }

  /** Decoded image, or null while it loads (onReady fires when it is available). */
  image(meta: AssetMeta | undefined, fallbackThumb?: string | null): SourceImage | null {
    if (!meta) return null
    const entry = this.images.get(meta.id)
    if (entry) {
      entry.lastUsed = performance.now()
      return entry.image
    }
    if (!this.pendingImages.has(meta.id)) void this.loadImage(meta, fallbackThumb)
    return null
  }

  private async loadImage(meta: AssetMeta, fallbackThumb?: string | null): Promise<void> {
    this.pendingImages.add(meta.id)
    try {
      let blob: Blob
      if (meta.kind === 'image') blob = await getAssetBlob(meta.id)
      else if (fallbackThumb) blob = await (await fetch(fallbackThumb)).blob()
      else return
      let bitmap = await createImageBitmap(blob)
      if (Math.max(bitmap.width, bitmap.height) > PREVIEW_IMAGE_SIDE) {
        const scale = PREVIEW_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height)
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: Math.round(bitmap.width * scale),
          resizeHeight: Math.round(bitmap.height * scale),
          resizeQuality: 'high',
        })
        bitmap.close()
        bitmap = resized
      }
      if (this.disposed) {
        bitmap.close()
        return
      }
      this.images.set(meta.id, {
        image: { source: bitmap, width: bitmap.width, height: bitmap.height },
        bytes: bitmap.width * bitmap.height * 4,
        lastUsed: performance.now(),
        failed: false,
      })
      this.evict()
      this.onReady()
    } catch {
      this.images.set(meta.id, { image: null, bytes: 0, lastUsed: performance.now(), failed: true })
    } finally {
      this.pendingImages.delete(meta.id)
    }
  }

  private evict(): void {
    let total = 0
    for (const e of this.images.values()) total += e.bytes
    if (total <= IMAGE_BUDGET_BYTES) return
    const byAge = [...this.images.entries()].toSorted((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [id, entry] of byAge) {
      if (total <= IMAGE_BUDGET_BYTES * 0.8) break
      if (entry.image?.source instanceof ImageBitmap) entry.image.source.close()
      total -= entry.bytes
      this.images.delete(id)
    }
  }

  /** Forget a decoded image (e.g. after an asset is replaced). */
  invalidate(assetId: string): void {
    const entry = this.images.get(assetId)
    if (entry?.image?.source instanceof ImageBitmap) entry.image.source.close()
    this.images.delete(assetId)
  }

  audioBuffer(ctx: BaseAudioContext, assetId: string): Promise<AudioBuffer | null> {
    let promise = this.audio.get(assetId)
    if (!promise) {
      promise = getAssetBlob(assetId)
        .then((blob) => blob.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch((error: unknown) => {
          console.warn('Preview could not decode audio', assetId, error)
          return null
        })
      this.audio.set(assetId, promise)
    }
    return promise
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.images.values()) {
      if (entry.image?.source instanceof ImageBitmap) entry.image.source.close()
    }
    this.images.clear()
    for (const url of this.resolvedUrls) URL.revokeObjectURL(url)
    this.resolvedUrls = []
    this.urls.clear()
    this.audio.clear()
  }
}
