import { useSyncExternalStore } from 'react'

/**
 * Hash-based routing: `#/` and `#/project/<id>`. Hash routes work on any static
 * host (GitHub Pages, Netlify, a USB stick) without server rewrite rules.
 */
export type Route = { name: 'home' } | { name: 'editor'; projectId: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const match = /^\/project\/([\w-]+)\/?$/.exec(path)
  if (match) return { name: 'editor', projectId: match[1]! }
  return { name: 'home' }
}

export function routeToHash(route: Route): string {
  return route.name === 'editor' ? `#/project/${route.projectId}` : '#/'
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const hash = routeToHash(route)
  if (options.replace) {
    history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else if (location.hash !== hash) {
    location.hash = hash
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

let cachedHash: string | null = null
let cachedRoute: Route = { name: 'home' }

function getSnapshot(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash
    cachedRoute = parseHash(location.hash)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, () => cachedRoute)
}
