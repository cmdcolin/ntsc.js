import { useSyncExternalStore } from 'react'

// A media query as an external store, for the one thing container queries can't
// answer: how much room the *viewport* has. Only the main window is asked — the
// popout is user-sized, and everything inside the panel sizes itself off the
// panel's own container query instead.
//
// The subscribe/snapshot pair is cached per query string in module scope.
// useSyncExternalStore tears the listener down and rebuilds it whenever
// `subscribe` changes identity, so a closure built during render would
// resubscribe on every commit; one MediaQueryList per query, made once, also
// means the browser evaluates each query once no matter how many callers ask.
interface QueryStore {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => boolean
}

const stores = new Map<string, QueryStore>()

function storeFor(query: string): QueryStore {
  const found = stores.get(query)
  if (found !== undefined) return found
  const mql = window.matchMedia(query)
  const store: QueryStore = {
    subscribe: onChange => {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    getSnapshot: () => mql.matches,
  }
  stores.set(query, store)
  return store
}

export function useMediaQuery(query: string): boolean {
  const store = storeFor(query)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
