import { HardDrive, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/format'
import { getStorageInfo, requestPersistentStorage, type StorageInfo } from '@/storage/repo'

/** Shows how much browser storage LocVid uses and whether it is protected from eviction. */
export function StorageCard({ refreshKey }: { refreshKey: number }) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const refresh = useCallback(() => {
    void getStorageInfo().then(setInfo)
  }, [])
  useEffect(refresh, [refresh, refreshKey])

  const pct = info?.usage != null && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : null

  return (
    <section className="rounded-xl border bg-card/60 p-4" aria-labelledby="storage-heading">
      <div className="flex items-center gap-2">
        <HardDrive className="size-4 text-muted-foreground" />
        <h2 id="storage-heading" className="text-sm font-medium">
          Local storage
        </h2>
      </div>
      {info?.usage != null ? (
        <div className="mt-3 grid gap-1.5">
          <Progress value={pct ?? 0} aria-label="Storage used" />
          <p className="text-xs text-muted-foreground tabular" data-testid="storage-usage">
            {formatBytes(info.usage)} used{info.quota ? ` of ~${formatBytes(info.quota)} available to this site` : ''}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">This browser does not report storage usage.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {info?.persisted ? (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="size-3.5" /> Persistent: the browser won't clear it automatically
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">
              Best-effort: the browser may clear data when the disk is nearly full.
            </span>
            {info?.canPersist ? (
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  const granted = await requestPersistentStorage()
                  if (granted) toast.success('Storage marked as persistent.')
                  else toast.info('The browser declined. It may grant this after you use the site more or bookmark it.')
                  refresh()
                }}
              >
                Ask to keep my data
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
