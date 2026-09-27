/**
 * Small key-value storage for settings, Daily results and the in-progress
 * Daily (docs/tech-spec.md §7). Web builds use IndexedDB and fall back to
 * memory when it is unavailable (private windows, blocked storage), so the
 * game still runs; `persistent` says which one you got. The Steam build's
 * shell keeps them as files instead (adapters/electron.ts); Android's shell
 * will too (M9).
 */
export interface KeyValueStore {
  readonly persistent: boolean;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    persistent: false,
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    set: async <T>(key: string, value: T) => {
      data.set(key, structuredClone(value));
    },
    remove: async (key: string) => {
      data.delete(key);
    },
  };
}

const STORE = 'kv';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

/** IndexedDB-backed store; resolves to a memory store if IndexedDB can't be opened within `timeoutMs`. */
export async function openStore(name = 'chooser-of-the-slain', timeoutMs = 3000): Promise<KeyValueStore> {
  let db: IDBDatabase;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('IndexedDB timed out')), timeoutMs);
    });
    db = await Promise.race([openDb(name), timeout]).finally(() => clearTimeout(timer));
  } catch {
    return memoryStore();
  }
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    persistent: true,
    get: async <T>(key: string) => (await request(tx('readonly').get(key))) as T | undefined,
    set: async <T>(key: string, value: T) => {
      await request(tx('readwrite').put(value, key));
    },
    remove: async (key: string) => {
      await request(tx('readwrite').delete(key));
    },
  };
}

/** Whether the browser has agreed to keep our data (false where it can't say). */
export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/** Asks the browser not to evict our data (Safari drops it after 7 days unused otherwise). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
