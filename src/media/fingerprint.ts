/**
 * Content fingerprint used to avoid storing the same file twice. Hashing a
 * multi-gigabyte video would be slow and memory-hungry, so we hash the size,
 * type and the first and last 2 MB — practically unique for real media files.
 */
const SAMPLE = 2 * 1024 * 1024

export async function fingerprintFile(file: Blob): Promise<string> {
  const head = file.slice(0, SAMPLE)
  const tail = file.size > SAMPLE * 2 ? file.slice(file.size - SAMPLE) : new Blob([])
  const header = new TextEncoder().encode(`${file.size}|${file.type}|`)
  const data = new Uint8Array(await new Blob([header, head, tail]).arrayBuffer())
  return `v1:${await digest(data)}`
}

async function digest(data: Uint8Array<ArrayBuffer>): Promise<string> {
  // crypto.subtle only exists in secure contexts (https/localhost); fall back to a fast non-crypto hash.
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data)
    return toHex(new Uint8Array(hash))
  }
  return fnv1a64(data)
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function fnv1a64(data: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1b873593
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i]!, 0x01000193)
    h2 = Math.imul(h2 ^ data[i]!, 0x85ebca6b)
  }
  return `fnv-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`
}
