import type { ReactNode } from 'react'
import { create } from 'zustand'

/**
 * Imperative confirm/prompt dialogs: `await confirm({...})` anywhere in the app,
 * rendered by <DialogHost />. Every destructive action goes through `confirm`
 * so the wording and behaviour are consistent.
 */

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  resolve: (ok: boolean) => void
}

export interface PromptRequest {
  kind: 'prompt'
  title: string
  description?: ReactNode
  label: string
  initialValue?: string
  confirmLabel?: string
  maxLength?: number
  resolve: (value: string | null) => void
}

type Request = ConfirmRequest | PromptRequest

export const useDialogQueue = create<{ current: Request | null; set: (r: Request | null) => void }>((set) => ({
  current: null,
  set: (current) => set({ current }),
}))

export function confirm(options: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogQueue.getState().current?.resolve(false as never)
    useDialogQueue.getState().set({ kind: 'confirm', ...options, resolve })
  })
}

export function promptText(options: Omit<PromptRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogQueue.getState().current?.resolve(null as never)
    useDialogQueue.getState().set({ kind: 'prompt', ...options, resolve })
  })
}

