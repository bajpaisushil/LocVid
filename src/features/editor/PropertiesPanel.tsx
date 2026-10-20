import { ScrollArea } from '@/components/ui/scroll-area'
import { useEditorStore } from '@/state/editorStore'
import { AudioTrackProperties } from './props/AudioTrackProperties'
import { ProjectProperties } from './props/ProjectProperties'
import { SceneProperties } from './props/SceneProperties'

/** Context-sensitive inspector: scene / text / audio clip / project settings. */
export function PropertiesPanel() {
  const selection = useEditorStore((s) => s.selection)
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l bg-panel" aria-label="Properties">
      <div className="flex h-11 shrink-0 items-center border-b px-3">
        <h2 className="text-sm font-medium">
          {selection.kind === 'audio' ? 'Audio' : selection.kind === 'none' ? 'Project' : 'Scene'}
        </h2>
        {selection.kind !== 'none' ? (
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() => useEditorStore.getState().select({ kind: 'none' })}
          >
            Project settings
          </button>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {selection.kind === 'scene' || selection.kind === 'overlay' ? (
          <SceneProperties
            key={selection.sceneId}
            sceneId={selection.sceneId}
            overlayId={selection.kind === 'overlay' ? selection.overlayId : null}
          />
        ) : selection.kind === 'audio' ? (
          <AudioTrackProperties key={selection.trackId} trackId={selection.trackId} />
        ) : (
          <ProjectProperties />
        )}
      </ScrollArea>
    </aside>
  )
}
