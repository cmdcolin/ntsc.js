// The one IndexedDB store the app keeps, and the four operations it needs.
//
// It holds FileSystemHandles and nothing else. They go here rather than in
// localStorage for the reason that decides every storage question in this app:
// a handle is structured-cloneable and a string is not, so IndexedDB can
// remember a file *by reference* where JSON could only remember its name.
//
// One store for two callers — 'a'/'b' for the file each source slot last had
// (fileStash.ts), 'clip:'/'folder:' for the library (clipLibrary.ts). They are
// the same kind of thing kept for the same reason, and a second store would
// mean a version bump and a migration for nothing.

const DB = 'ntsc.js'
const VERSION = 1
const STORE = 'handles'

const idbError = (e: DOMException | null): Error =>
  e === null
    ? new Error('indexeddb failed')
    : new Error(`indexeddb: ${e.message}`)

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.addEventListener('upgradeneeded', () => {
      req.result.createObjectStore(STORE)
    })
    req.addEventListener('success', () => resolve(req.result))
    req.addEventListener('error', () => reject(idbError(req.error)))
  })

// One transaction, resolved on *commit* — a put that is merely queued is not a
// put that survives the reload. `run` may issue several requests; what it hands
// back is what the caller gets, so a batch reads through one open connection
// rather than one per key.
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => () => T,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const result = run(tx.objectStore(STORE))
      tx.addEventListener('complete', () => resolve(result()))
      tx.addEventListener('error', () => reject(idbError(tx.error)))
      tx.addEventListener('abort', () => reject(idbError(tx.error)))
    })
  } finally {
    db.close()
  }
}

export const idbGet = (key: string): Promise<unknown> =>
  withStore('readonly', store => {
    const req = store.get(key)
    return () => req.result as unknown
  })

// Every key in one transaction, in the order asked for. The library resolves a
// whole shelf when its dialog opens, and a connection per clip is a connection
// per row.
export const idbGetMany = (keys: readonly string[]): Promise<unknown[]> =>
  withStore('readonly', store => {
    const reqs = keys.map(key => store.get(key))
    return () => reqs.map(req => req.result as unknown)
  })

export const idbPut = (key: string, value: unknown): Promise<void> =>
  withStore('readwrite', store => {
    store.put(value, key)
    return () => undefined
  })

export const idbDelete = (keys: readonly string[]): Promise<void> =>
  withStore('readwrite', store => {
    for (const key of keys) store.delete(key)
    return () => undefined
  })
