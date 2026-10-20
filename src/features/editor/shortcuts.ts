import { useEffect } from 'react'
import { toast } from 'sonner'
import { removeOverlay } from '@/core/operations'
import { buildTimeline } from '@/core/timeline'
import { isModKey } from '@/lib/platform'
import { useEditorStore } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { sceneActions } from './sceneActions'

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(type)
  }
  return false
}

/** Native controls where Space/arrows already mean something. */
function isNativeControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'BUTTON' ||
    target.getAttribute('role') === 'slider' ||
    target.getAttribute('role') === 'tab' ||
    target.getAttribute('role') === 'menuitem' ||
    target.getAttribute('role') === 'option' ||
    target.getAttribute('role') === 'switch'
  )
}

/**
 * Editor keyboard shortcuts. Space play/pause · ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo ·
 * Delete removes the selected text or scene · ⌘/Ctrl+D duplicates the scene ·
 * ←/→ step a frame (⇧ = 1 s) · Home/End · Esc clears the selection.
 */
export function useEditorShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const editor = useEditorStore.getState()
      const playback = usePlaybackStore.getState()
      const project = editor.project
      if (!project) return
      const mod = isModKey(e)
      const key = e.key.toLowerCase()

      if (mod && key === 'z' && !isTextEntry(e.target)) {
        e.preventDefault()
        if (e.shiftKey) editor.redo()
        else editor.undo()
        return
      }
      if (mod && key === 'y' && !isTextEntry(e.target)) {
        e.preventDefault()
        editor.redo()
        return
      }
      if (isTextEntry(e.target)) return

      if (mod && key === 'd') {
        const sel = editor.selection
        if (sel.kind === 'scene' || sel.kind === 'overlay') {
          e.preventDefault()
          sceneActions().duplicate(sel.sceneId)
        }
        return
      }
      if (e.key === ' ' && !isNativeControl(e.target)) {
        e.preventDefault()
        if (project.scenes.length) playback.toggle()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isNativeControl(e.target)) {
        const sel = editor.selection
        if (sel.kind === 'overlay') {
          e.preventDefault()
          editor.apply((d) => {
            const scene = d.scenes.find((s) => s.id === sel.sceneId)
            if (scene) removeOverlay(scene, sel.overlayId)
          })
          editor.select({ kind: 'scene', sceneId: sel.sceneId })
          toast('Text deleted', { action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() } })
        } else if (sel.kind === 'scene') {
          e.preventDefault()
          const index = project.scenes.findIndex((s) => s.id === sel.sceneId)
          sceneActions().remove(sel.sceneId)
          toast(`Scene ${index + 1} deleted`, { action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() } })
        }
        return
      }
      if (isNativeControl(e.target) && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) return
      // Arrow keys on a focused scene block reorder it (keyboard drag), they don't seek.
      if (e.target instanceof HTMLElement && e.target.getAttribute('aria-roledescription') === 'sortable scene' && e.key.startsWith('Arrow')) return
      const fps = project.output.fps
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        playback.pause()
        const step = e.shiftKey ? 1 : 1 / fps
        playback.seek(Math.max(0, playback.time + (e.key === 'ArrowLeft' ? -step : step)))
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        playback.seek(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        playback.seek(buildTimeline(project).duration)
        return
      }
      if (e.key === 'Escape') {
        const sel = editor.selection
        editor.select(sel.kind === 'overlay' ? { kind: 'scene', sceneId: sel.sceneId } : { kind: 'none' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
