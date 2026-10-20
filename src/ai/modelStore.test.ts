import { afterEach, describe, expect, it, vi } from 'vitest'
import { anySignal, StallWatch } from './modelStore'

afterEach(() => {
  vi.useRealTimers()
})

describe('model download watchdog', () => {
  it('aborts only after a full quiet period, and every chunk resets the clock', () => {
    vi.useFakeTimers()
    const watch = new StallWatch(1000)
    vi.advanceTimersByTime(900)
    watch.poke()
    vi.advanceTimersByTime(900)
    expect(watch.signal.aborted).toBe(false)
    vi.advanceTimersByTime(150)
    expect(watch.signal.aborted).toBe(true)
    expect(watch.fired).toBe(true)
  })

  it('stays quiet once stopped', () => {
    vi.useFakeTimers()
    const watch = new StallWatch(1000)
    watch.stop()
    vi.advanceTimersByTime(5000)
    expect(watch.signal.aborted).toBe(false)
  })

  it('combines the user’s cancel with the stall signal', () => {
    const user = new AbortController()
    const stall = new AbortController()
    const both = anySignal([user.signal, stall.signal])
    expect(both.aborted).toBe(false)
    user.abort()
    expect(both.aborted).toBe(true)
  })
})
