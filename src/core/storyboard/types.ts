/**
 * Storyboard assistant contract. The built-in implementation is rule-based
 * (see rules.ts). A local language model can implement the same interface
 * later (e.g. via Transformers.js) and the editor will not need to change.
 */

export interface StoryboardOptions {
  split: 'auto' | 'paragraphs' | 'sentences'
  wordsPerMinute: number
  minSeconds: number
  maxSeconds: number
  captions: 'full' | 'firstSentence' | 'none'
  matchImages: boolean
  reuseImages: boolean
}

export const DEFAULT_STORYBOARD_OPTIONS: StoryboardOptions = {
  split: 'auto',
  wordsPerMinute: 150,
  minSeconds: 2.5,
  maxSeconds: 12,
  captions: 'full',
  matchImages: true,
  reuseImages: false,
}

export interface ImageCandidate {
  id: string
  name: string
}

export interface StoryboardRequest {
  text: string
  options: StoryboardOptions
  images: ImageCandidate[]
}

export interface DraftScene {
  title: string
  /** The script text this scene covers (stored in scene notes). */
  narration: string
  /** On-screen text; empty = no caption. */
  caption: string
  duration: number
  keywords: string[]
  imageId: string | null
  /** Human-readable reason for the image choice, shown in the review table. */
  imageReason: string | null
  /** Heading-only or topic-title scenes get a title card style instead of a caption. */
  isTitleCard: boolean
}

export interface StoryboardDraft {
  scenes: DraftScene[]
  /** Who produced it — the UI labels rule-based output as such. */
  source: 'rules' | 'local-model'
  notes: string[]
}

export type AssistantStatus =
  | { state: 'ready' }
  | { state: 'needs-download'; sizeBytes: number }
  | { state: 'unsupported'; reason: string }

export interface StoryboardAssistant {
  id: string
  label: string
  kind: 'rules' | 'local-model'
  status(): Promise<AssistantStatus>
  generate(request: StoryboardRequest, signal?: AbortSignal): Promise<StoryboardDraft>
}
