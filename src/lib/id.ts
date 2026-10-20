/** Collision-resistant random ID (URL-safe). Uses Web Crypto, available in browsers, workers and Node. */
export function createId(prefix = ''): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b & 63]
  return prefix ? `${prefix}_${out}` : out
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Deterministic 32-bit hash of a string (FNV-1a). Used for seeds, not security. */
export function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
