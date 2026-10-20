import { generateRuleBased } from './rules'
import type { StoryboardAssistant } from './types'

export const ruleBasedAssistant: StoryboardAssistant = {
  id: 'rules',
  label: 'Built-in rules (no AI)',
  kind: 'rules',
  status: () => Promise.resolve({ state: 'ready' }),
  generate: (request) => Promise.resolve(generateRuleBased(request)),
}

const registry = new Map<string, StoryboardAssistant>([[ruleBasedAssistant.id, ruleBasedAssistant]])

/** Optional local models register here; the rule-based assistant is always available. */
export function registerAssistant(assistant: StoryboardAssistant): void {
  registry.set(assistant.id, assistant)
}

export function listAssistants(): StoryboardAssistant[] {
  return [...registry.values()]
}
