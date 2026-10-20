import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
export const fixture = (name: string) => path.join(here, 'fixtures', name)

export async function createProject(page: Page, name: string, aspect: 'Landscape 16:9' | 'Vertical 9:16' | 'Square 1:1' = 'Landscape 16:9') {
  await page.goto('/')
  await page.getByTestId('new-project').click()
  await page.locator('#new-project-name').fill(name)
  await page.getByText(aspect).click()
  await page.getByTestId('create-project').click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('project-name')).toHaveText(name)
}

export async function importMedia(page: Page, files: string[], expectTiles: number) {
  await page.getByTestId('media-input').setInputFiles(files.map(fixture))
  await expect(page.getByTestId('asset-tile')).toHaveCount(expectTiles, { timeout: 30_000 })
}

/** Click the toast action that turns freshly imported media into scenes. */
export async function createScenesFromImport(page: Page, expectScenes: number) {
  await page.getByRole('button', { name: /Create scenes|as scenes/ }).first().click()
  await expect(page.getByTestId('scene-block')).toHaveCount(expectScenes)
}

export async function waitForSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 })
}

/** Average RGB of a region of the preview canvas (fractions of its size). */
export async function sampleCanvas(page: Page, fx: number, fy: number, size = 0.04): Promise<[number, number, number]> {
  return page.evaluate(
    (at) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!
      const ctx = canvas.getContext('2d')!
      const w = Math.max(1, Math.round(canvas.width * at.size))
      const h = Math.max(1, Math.round(canvas.height * at.size))
      const data = ctx.getImageData(Math.round(canvas.width * at.fx - w / 2), Math.round(canvas.height * at.fy - h / 2), w, h).data
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!
        g += data[i + 1]!
        b += data[i + 2]!
      }
      const n = data.length / 4
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as [number, number, number]
    },
    { fx, fy, size },
  )
}

/** Fraction of near-white pixels in a canvas region (detects rendered text). */
export async function whitePixelRatio(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  return page.evaluate(
    (box) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!
      const ctx = canvas.getContext('2d')!
      const x = Math.round(canvas.width * box.x0)
      const y = Math.round(canvas.height * box.y0)
      const data = ctx.getImageData(x, y, Math.round(canvas.width * box.x1) - x, Math.round(canvas.height * box.y1) - y).data
      let white = 0
      for (let i = 0; i < data.length; i += 4) if (data[i]! > 230 && data[i + 1]! > 230 && data[i + 2]! > 230) white++
      return white / (data.length / 4)
    },
    { x0, y0, x1, y1 },
  )
}

export function isColor(rgb: [number, number, number], target: [number, number, number], tolerance = 40) {
  return rgb.every((c, i) => Math.abs(c - target[i]!) <= tolerance)
}

export const RED: [number, number, number] = [224, 24, 24]
export const BLUE: [number, number, number] = [24, 48, 224]
export const MAGENTA: [number, number, number] = [224, 24, 224]

/** Seek the preview with the editor's keyboard shortcuts (Home, then Shift+→ per second). */
export async function seekTo(page: Page, seconds: number) {
  // A closing select hands focus back to its trigger after its exit animation; wait for that
  // first, then leave any control so the editor's keyboard shortcuts apply.
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Home')
  for (let i = 0; i < Math.floor(seconds); i++) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(250)
}

export const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

export interface ProbeResult {
  format: { duration: string; size: string }
  streams: { codec_type: string; codec_name: string; profile?: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; sample_rate?: string; channels?: number; pix_fmt?: string }[]
}

export function ffprobe(file: string): ProbeResult {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })
  return JSON.parse(out) as ProbeResult
}

/** Decode the whole file; returns ffmpeg's error output (empty = clean decode). */
export function decodeErrors(file: string): string {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' })
  return `${result.stderr ?? ''}`.trim()
}

/** Average RGB of a small center-ish patch of the exported frame at `t` seconds. */
export function frameColor(file: string, t: number, crop = '40:40:620:500'): [number, number, number] {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [buf[0]!, buf[1]!, buf[2]!]
}

/** Mean level (dB) of one frequency band in a time window, to check what is audible when. */
export function bandLevel(file: string, start: number, duration: number, hz: number): number {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-ss', String(start), '-t', String(duration), '-i', file, '-vn', '-af', `bandpass=f=${hz}:width_type=h:w=40,volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const matches = [...`${result.stderr ?? ''}`.matchAll(/mean_volume: (-?[\d.]+) dB/g)]
  return Number(matches.at(-1)?.[1] ?? Number.NaN)
}
