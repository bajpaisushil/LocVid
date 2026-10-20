import { useRoute } from '@/app/router'
import { DialogHost } from '@/components/dialogs'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EditorScreen } from '@/features/editor/EditorScreen'
import { HomeScreen } from '@/features/home/HomeScreen'

export function App() {
  const route = useRoute()
  return (
    <TooltipProvider delayDuration={400}>
      {route.name === 'editor' ? <EditorScreen key={route.projectId} projectId={route.projectId} /> : <HomeScreen />}
      <DialogHost />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
