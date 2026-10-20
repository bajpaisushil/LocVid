/** Modifier key label for shortcuts: ⌘ on Apple platforms, Ctrl elsewhere. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '\u2318' : 'Ctrl'

/** True when the platform's primary modifier (⌘ or Ctrl) is held. */
export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return MOD_KEY === 'Ctrl' ? event.ctrlKey : event.metaKey
}
