/** The one place the export worker is constructed (so the bundler emits it once). */
export function createExportWorker(): Worker {
  return new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
}
