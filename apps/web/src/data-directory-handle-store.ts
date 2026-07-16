const DB_NAME = "tuckmark-file-system-handles"
const DB_VERSION = 1
const HANDLE_STORE = "handles"
const DATA_DIRECTORY_KEY = "data-directory"

type StoredHandleRecord = {
  key: string
  handle: FileSystemDirectoryHandle
  savedAt: string
}

function canUseIndexedDb() {
  return typeof indexedDB !== "undefined"
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: "key" })
      }
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openDatabase()
  const tx = db.transaction([HANDLE_STORE], mode)
  const store = tx.objectStore(HANDLE_STORE)
  return await callback(store)
}

export function supportsDirectoryHandles() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
}

export async function loadStoredDataDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!canUseIndexedDb() || !supportsDirectoryHandles()) {
    return null
  }
  try {
    return await withStore("readonly", async (store) => {
      const record = await requestToPromise(store.get(DATA_DIRECTORY_KEY))
      return (record as StoredHandleRecord | undefined)?.handle ?? null
    })
  } catch {
    return null
  }
}

export async function saveDataDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (!canUseIndexedDb() || !supportsDirectoryHandles()) {
    return
  }
  await withStore("readwrite", async (store) => {
    await requestToPromise(
      store.put({
        key: DATA_DIRECTORY_KEY,
        handle,
        savedAt: new Date().toISOString(),
      } satisfies StoredHandleRecord)
    )
  })
}

export async function clearStoredDataDirectoryHandle(): Promise<void> {
  if (!canUseIndexedDb()) {
    return
  }
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(DATA_DIRECTORY_KEY))
  })
}
