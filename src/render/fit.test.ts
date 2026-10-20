import { describe, expect, it } from 'vitest'
import { containRect, controlsFromCrop, coverRect, cropAround, cropFromControls, cropSourceRect } from './fit'

describe('fit math', () => {
  it('contain letterboxes and cover fills', () => {
    expect(containRect(1000, 500, 1280, 720)).toEqual({ x: 0, y: 40, width: 1280, height: 640 })
    expect(coverRect(1000, 500, 1280, 720)).toEqual({ x: -80, y: 0, width: 1440, height: 720 })
  })

  it('crop controls round-trip', () => {
    const crop = cropFromControls({ zoom: 2, focusX: 0.3, focusY: 0.7 }, 4000, 3000, 16 / 9)
    const back = controlsFromCrop(crop, 4000, 3000, 16 / 9)
    expect(back.zoom).toBeCloseTo(2)
    expect(back.focusX).toBeCloseTo(0.3)
    expect(back.focusY).toBeCloseTo(0.7)
  })

  it('crop rects always keep the frame aspect ratio and stay inside the image', () => {
    const r = cropSourceRect({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 1000, 1000, 16 / 9)
    expect(r.width / r.height).toBeCloseTo(16 / 9)
    expect(r.x + r.width).toBeLessThanOrEqual(1000)
    expect(r.y + r.height).toBeLessThanOrEqual(1000)
  })

  it('frames a close-up around a subject, clamped to the image', () => {
    const c = cropAround({ x: 0.7, y: 0.4 }, 2, 512, 512, 16 / 9)
    expect(c.width).toBeCloseTo(0.5)
    expect((c.width * 512) / (c.height * 512)).toBeCloseTo(16 / 9)
    expect(c.x + c.width / 2).toBeCloseTo(0.7)
    const edge = cropAround({ x: 0.99, y: 0.5 }, 2, 512, 512, 16 / 9)
    expect(edge.x + edge.width).toBeLessThanOrEqual(1.0000001)
  })
})
