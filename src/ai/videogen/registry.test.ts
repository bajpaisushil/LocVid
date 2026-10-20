import { describe, expect, it } from 'vitest'
import { listVideoGenerators, readyVideoGenerator, registerVideoGenerator, type VideoGenerator } from './registry'

const fake = (id: string, status: () => Promise<Awaited<ReturnType<VideoGenerator['status']>>>): VideoGenerator => ({
  id,
  label: id,
  license: { name: 'MIT', url: 'https://example.invalid' },
  status,
  generate: () => Promise.resolve(new Blob([], { type: 'video/mp4' })),
})

describe('video generator adapter point', () => {
  it('offers nothing until a generator is registered and ready, and skips broken adapters', async () => {
    expect(listVideoGenerators()).toEqual([])
    expect(await readyVideoGenerator()).toBeNull()
    registerVideoGenerator(fake('broken', () => Promise.reject(new Error('no GPU'))))
    registerVideoGenerator(fake('big', () => Promise.resolve({ state: 'needs-download', bytes: 5e9 })))
    expect(await readyVideoGenerator()).toBeNull()
    registerVideoGenerator(fake('tiny', () => Promise.resolve({ state: 'ready' })))
    expect((await readyVideoGenerator())?.id).toBe('tiny')
  })
})
