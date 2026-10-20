/**
 * A prompt typed on the home screen, handed to the editor of the project it
 * created (in memory only; nothing is persisted or sent anywhere).
 */
const pending = new Map<string, string>()

export function setPendingPrompt(projectId: string, prompt: string): void {
  pending.set(projectId, prompt)
}

export function takePendingPrompt(projectId: string): string | null {
  const prompt = pending.get(projectId) ?? null
  pending.delete(projectId)
  return prompt
}
