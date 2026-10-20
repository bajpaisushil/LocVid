import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  BLUE,
  MAGENTA,
  RED,
  bandLevel,
  createProject,
  createScenesFromImport,
  decodeErrors,
  ffprobe,
  frameColor,
  hasFfprobe,
  importMedia,
  isColor,
} from './helpers.ts'

async function buildProject(page: Page, name: string) {
  await createProject(page, name)
  await importMedia(page, ['red-beach.png', 'blue-mountain.png', 'clip-magenta.mp4', 'music.mp3'], 4)
  await createScenesFromImport(page, 3)
  await page.getByRole('button', { name: 'Actions for music.mp3' }).click()
  await page.getByRole('menuitem', { name: /background music/ }).click()
  await expect(page.getByTestId('audio-track')).toHaveCount(1)
  await page.getByTestId('scene-block').first().click()
  await page.getByTestId('add-text').click()
  await page.getByTestId('add-text-title').click()
  await page.getByTestId('overlay-text').fill('Exported title')
}

async function exportWith(page: Page, engine: 'webcodecs' | 'ffmpeg', outFile: string) {
  await page.getByTestId('open-export').click()
  await page.getByTestId(`engine-${engine}`).click()
  const download = page.waitForEvent('download', { timeout: 300_000 })
  await page.getByTestId('start-export').click()
  // Real progress is shown while rendering…
  await expect(page.getByTestId('export-running').or(page.getByTestId('export-done'))).toBeVisible()
  // …and success only once the verified file exists.
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 300_000 })
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.mp4$/)
  await file.saveAs(outFile)
  return outFile
}

function verifyMp4(path: string) {
  const bytes = readFileSync(path)
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp')
  if (!hasFfprobe) {
    test.info().annotations.push({ type: 'note', description: 'ffprobe not installed: deep MP4 checks skipped' })
    return
  }
  const probe = ffprobe(path)
  const video = probe.streams.find((s) => s.codec_type === 'video')!
  const audio = probe.streams.find((s) => s.codec_type === 'audio')!
  expect(video.codec_name).toBe('h264')
  expect(video.width).toBe(1280)
  expect(video.height).toBe(720)
  expect(video.pix_fmt).toBe('yuv420p')
  expect(video.r_frame_rate).toBe('30/1')
  expect(Number(video.nb_frames)).toBe(390)
  expect(audio.codec_name).toBe('aac')
  expect(audio.sample_rate).toBe('48000')
  expect(audio.channels).toBe(2)
  expect(Number(probe.format.duration)).toBeGreaterThan(12.9)
  expect(Number(probe.format.duration)).toBeLessThan(13.2)
  // A standard decoder reads every frame without errors.
  expect(decodeErrors(path)).toBe('')
  // Scenes appear in order, with the right content.
  expect(isColor(frameColor(path, 2.5), RED)).toBe(true)
  expect(isColor(frameColor(path, 7.5), BLUE)).toBe(true)
  expect(isColor(frameColor(path, 11.5), MAGENTA)).toBe(true)
  // Music plays throughout; the clip's 440 Hz tone only during the video scene (where music is ducked).
  expect(bandLevel(path, 3, 1, 220)).toBeGreaterThan(-35)
  expect(bandLevel(path, 3, 1, 440)).toBeLessThan(-40)
  expect(bandLevel(path, 11, 1, 440)).toBeGreaterThan(-30)
  expect(bandLevel(path, 11, 1, 220)).toBeLessThan(bandLevel(path, 3, 1, 220) - 6)
}

test('exports a real MP4 with the fast WebCodecs engine', async ({ page }, info) => {
  await buildProject(page, 'Export WebCodecs')
  const out = await exportWith(page, 'webcodecs', info.outputPath('webcodecs.mp4'))
  await expect(page.getByTestId('export-done')).toContainText('WebCodecs')
  verifyMp4(out)
})

test('exports a real MP4 with the FFmpeg.wasm compatibility engine', async ({ page }, info) => {
  await buildProject(page, 'Export FFmpeg')
  const out = await exportWith(page, 'ffmpeg', info.outputPath('ffmpeg.mp4'))
  await expect(page.getByTestId('export-done')).toContainText('FFmpeg.wasm')
  verifyMp4(out)
})

test('export explains what is wrong when media is missing', async ({ page }) => {
  // A project file referencing media this browser doesn't have.
  const project = {
    schemaVersion: 1,
    id: 'prj_missing',
    name: 'Missing media',
    aspectRatio: '16:9',
    output: { resolution: '720p', fps: 30 },
    scenes: [
      {
        id: 'scn_1',
        title: 'Lost photo',
        notes: '',
        duration: 3,
        background: { kind: 'media', assetId: 'ast_gone', fit: 'cover', crop: { x: 0, y: 0, width: 1, height: 1 }, fill: 'blur', fillColor: '#000000', trimStart: 0, volume: 0, loop: true },
        motion: { preset: 'none', intensity: 0.5, easing: 'easeInOut' },
        transition: { type: 'none', duration: 0.6 },
        overlays: [],
        audio: null,
      },
    ],
    audioTracks: [],
    assetIds: ['ast_gone'],
    brand: { logoAssetId: null, position: 'top-right', size: 0.1, opacity: 0.85 },
    fadeOutEnd: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  await page.goto('/')
  await page.getByTestId('import-project-input').setInputFiles({
    name: 'missing.locvid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'locvid-project', formatVersion: 1, project, assets: [] })),
  })
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Imported “Missing media”' })).toContainText('1 media file is not in this browser')
  await page.getByRole('button', { name: 'Open Missing media' }).click()
  await expect(page.getByTestId('scene-block')).toContainText('missing media')
  await page.getByTestId('open-export').click()
  await expect(page.getByTestId('export-problems')).toContainText('Scene 1 uses media that is missing from this browser')
  await expect(page.getByTestId('start-export')).toBeDisabled()
})

test('an empty project cannot be exported and says why', async ({ page }) => {
  await createProject(page, 'Empty')
  await page.getByTestId('open-export').click()
  await expect(page.getByTestId('export-problems')).toContainText('Add at least one scene')
  await expect(page.getByTestId('start-export')).toBeDisabled()
})
