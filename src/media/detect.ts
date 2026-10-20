import type { AssetKind } from '@/core/types'

/** Accepted formats. Final say is whether the browser can actually decode the file (checked during import). */
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'heic', 'heif']
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba']

const MB = 1024 * 1024
export const SIZE_LIMITS: Record<AssetKind, number> = {
  image: 60 * MB,
  video: 2048 * MB,
  audio: 500 * MB,
}

export const ACCEPT_ATTRIBUTE = [
  'image/*',
  'video/*',
  'audio/*',
  ...[...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT].map((e) => `.${e}`),
].join(',')

export const SUPPORTED_SUMMARY = 'JPG, PNG, WebP, GIF, AVIF, SVG · MP4, MOV, WebM · MP3, WAV, M4A, OGG, FLAC'

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function detectKind(file: Pick<File, 'name' | 'type'>): AssetKind | null {
  const type = file.type.toLowerCase()
  const ext = extensionOf(file.name)
  if (type.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image'
  if (type.startsWith('video/') || VIDEO_EXT.includes(ext)) {
    // Some systems label .m4a/.ogg audio as video/*; trust the extension for audio-only containers.
    if (AUDIO_EXT.includes(ext)) return 'audio'
    return 'video'
  }
  if (type.startsWith('audio/') || AUDIO_EXT.includes(ext)) return 'audio'
  return null
}

/** Best-guess MIME type when the OS didn't provide one. */
export function guessMime(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type
  const ext = extensionOf(file.name)
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    ogv: 'video/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    weba: 'audio/webm',
  }
  return map[ext] ?? 'application/octet-stream'
}

export class MediaImportError extends Error {
  readonly fileName: string
  constructor(message: string, fileName: string) {
    super(message)
    this.name = 'MediaImportError'
    this.fileName = fileName
  }
}

/** Cheap checks before reading the file: type and size. */
export function validateFile(file: Pick<File, 'name' | 'type' | 'size'>): AssetKind {
  const kind = detectKind(file)
  if (!kind) {
    throw new MediaImportError('Not a supported image, video or audio file.', file.name)
  }
  if (file.size === 0) throw new MediaImportError('The file is empty.', file.name)
  const limit = SIZE_LIMITS[kind]
  if (file.size > limit) {
    throw new MediaImportError(
      `Too large (${Math.round(file.size / MB)} MB). The limit for ${kind} files is ${Math.round(limit / MB)} MB.`,
      file.name,
    )
  }
  return kind
}
