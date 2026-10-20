/** 75.4 → "1:15.4" (tenths) or "1:15" when `tenths` is false. */
export function formatTime(seconds: number, tenths = true): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const total = tenths ? Math.floor(safe * 10) / 10 : Math.floor(safe)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  const whole = Math.floor(s)
  const ss = String(whole).padStart(2, '0')
  if (!tenths) return `${m}:${ss}`
  const t = Math.round((s - whole) * 10) % 10
  return `${m}:${ss}.${t}`
}

/** Compact duration for labels: 4.5 → "4.5s", 75 → "1:15". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`
  return formatTime(seconds, false)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or a date. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return 'just now'
  if (diff < hour) return `${Math.floor(diff / min)} min ago`
  if (diff < day) return `${Math.floor(diff / hour)} h ago`
  if (diff < 7 * day) {
    const d = Math.floor(diff / day)
    return d === 1 ? 'yesterday' : `${d} days ago`
  }
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
