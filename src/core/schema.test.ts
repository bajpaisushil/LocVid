import { describe, expect, it } from 'vitest'
import { createAudioTrack, createOverlay, createProject, createScene, outputDimensions } from './defaults'
import { ProjectValidationError, parseAssetMeta, parseProject, serializeProject } from './schema'
import { SCHEMA_VERSION, type Project } from './types'

function sampleProject(): Project {
  const project = createProject({ name: 'Trip to the coast', aspectRatio: '9:16', now: 1_700_000_000_000 })
  const a = createScene({ index: 0, asset: { id: 'ast_img', kind: 'image' } })
  const b = createScene({ index: 1, duration: 3.5 })
  a.overlays.push(createOverlay('Hello coast', 'title', '9:16'))
  b.overlays.push(createOverlay('Day two', 'caption', '9:16'))
  b.audio = { assetId: 'ast_voice', volume: 1, offset: 0.25 }
  project.scenes = [a, b]
  project.assetIds = ['ast_img', 'ast_voice', 'ast_music']
  project.audioTracks = [createAudioTrack({ id: 'ast_music', duration: 120 })]
  return project
}

describe('project schema', () => {
  it('round-trips through JSON without losing ordering or settings', () => {
    const project = sampleProject()
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored).toEqual(project)
    expect(restored.scenes.map((s) => s.id)).toEqual(project.scenes.map((s) => s.id))
  })

  it('accepts freshly created defaults', () => {
    const project = createProject()
    expect(() => parseProject(project)).not.toThrow()
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('clamps out-of-range numbers instead of failing', () => {
    const project = sampleProject()
    const raw = JSON.parse(serializeProject(project))
    raw.scenes[0].duration = 99999
    raw.scenes[0].motion.intensity = 7
    raw.scenes[1].overlays[0].fontSize = -1
    const restored = parseProject(raw)
    expect(restored.scenes[0]!.duration).toBe(300)
    expect(restored.scenes[0]!.motion.intensity).toBe(1)
    expect(restored.scenes[1]!.overlays[0]!.fontSize).toBe(0.01)
  })

  it('falls back to defaults for unknown enum values', () => {
    const raw = JSON.parse(serializeProject(sampleProject()))
    raw.scenes[0].transition.type = 'spinny-cube'
    raw.aspectRatio = '21:9'
    const restored = parseProject(raw)
    expect(restored.scenes[0]!.transition.type).toBe('none')
    expect(restored.aspectRatio).toBe('16:9')
  })

  it('rejects structurally broken data with a readable message', () => {
    const raw = JSON.parse(serializeProject(sampleProject()))
    delete raw.scenes
    expect(() => parseProject(raw)).toThrow(ProjectValidationError)
    expect(() => parseProject(raw)).toThrow(/scenes/)
    expect(() => parseProject('nope')).toThrow(/not an object/)
    expect(() => parseProject({ ...raw, schemaVersion: undefined })).toThrow(/schema version/)
  })

  it('refuses projects from a newer schema version', () => {
    const raw = { ...JSON.parse(serializeProject(sampleProject())), schemaVersion: SCHEMA_VERSION + 1 }
    expect(() => parseProject(raw)).toThrow(/newer version/)
  })

  it('rejects duplicate scene ids', () => {
    const project = sampleProject()
    project.scenes[1]!.id = project.scenes[0]!.id
    expect(() => parseProject(JSON.parse(serializeProject(project)))).toThrow(/Duplicate scene/)
  })

  it('repairs the asset bin so every referenced asset is listed', () => {
    const project = sampleProject()
    project.assetIds = []
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.assetIds.toSorted()).toEqual(['ast_img', 'ast_music', 'ast_voice'])
  })

  it('drops an overlay end time that is before its start', () => {
    const project = sampleProject()
    const overlay = project.scenes[0]!.overlays[0]!
    overlay.start = 2
    overlay.end = 1
    expect(parseProject(JSON.parse(serializeProject(project))).scenes[0]!.overlays[0]!.end).toBeNull()
  })
})

describe('asset metadata', () => {
  it('validates asset records', () => {
    const meta = parseAssetMeta({
      id: 'ast_1',
      kind: 'video',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      size: 1024,
      width: 1920,
      height: 1080,
      duration: 12.5,
      hasAudio: true,
      fingerprint: 'abc',
      origin: 'import',
      createdAt: 1,
    })
    expect(meta.kind).toBe('video')
    expect(() => parseAssetMeta({ id: 'x', kind: 'pdf' })).toThrow(ProjectValidationError)
  })
})

describe('output dimensions', () => {
  it('maps aspect ratio and preset to even pixel sizes', () => {
    expect(outputDimensions('16:9', '720p')).toEqual({ width: 1280, height: 720 })
    expect(outputDimensions('9:16', '1080p')).toEqual({ width: 1080, height: 1920 })
    expect(outputDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 })
  })
})
