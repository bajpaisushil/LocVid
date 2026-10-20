import { describe, expect, it } from 'vitest'
import { generationSize } from './client'

describe('generation size', () => {
  it('draws pictures in the video’s shape, in multiples of 64 px, near the model’s native pixel count', () => {
    for (const aspect of ['16:9', '9:16', '1:1'] as const) {
      const { width, height } = generationSize(aspect)
      expect(width % 64).toBe(0)
      expect(height % 64).toBe(0)
      expect(width * height).toBeGreaterThanOrEqual(512 * 512)
      expect(width * height).toBeLessThanOrEqual(512 * 512 * 1.35)
    }
    const wide = generationSize('16:9')
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 0)
    expect(generationSize('9:16')).toEqual({ width: wide.height, height: wide.width })
  })
})
