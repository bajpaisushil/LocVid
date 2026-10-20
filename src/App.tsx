import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useRoute } from '@/app/router'
import { DialogHost } from '@/components/dialogs'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HomeScreen } from '@/features/home/HomeScreen'

// The editor (renderer, media and export code) loads on demand, keeping the home screen light.
const EditorScreen = lazy(() => import('@/features/editor/EditorScreen').then((m) => ({ default: m.EditorScreen })))

function Loading() {
  return (
    <div className="grid h-full place-items-center text-muted-foreground" aria-busy="true">
      <span className="inline-flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading editor…
      </span>
    </div>
  )
}

export function App() {
  const route = useRoute()
  return (
    <TooltipProvider delayDuration={400}>
      {route.name === 'editor' ? (
        <Suspense fallback={<Loading />}>
          <EditorScreen key={route.projectId} projectId={route.projectId} />
        </Suspense>
      ) : (
        <HomeScreen />
      )}
      <DialogHost />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
