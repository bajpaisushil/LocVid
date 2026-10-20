/** Trigger a browser download for a Blob without navigating away. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Make a string safe for use as a file name on all major OSes. */
export function safeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    // oxlint-disable-next-line no-control-regex -- strip control characters from file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || fallback
}
