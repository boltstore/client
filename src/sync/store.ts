export interface SyncStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryStore implements SyncStore {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/** localStorage-based store. Works in browsers and any environment with localStorage. */
export function createWebStore(prefix = "boltstore_sync_"): SyncStore {
  const hasStorage = typeof localStorage !== "undefined";
  return {
    async get(key: string): Promise<string | null> {
      if (!hasStorage) return null;
      return localStorage.getItem(prefix + key);
    },
    async set(key: string, value: string): Promise<void> {
      if (!hasStorage) return;
      localStorage.setItem(prefix + key, value);
    },
    async remove(key: string): Promise<void> {
      if (!hasStorage) return;
      localStorage.removeItem(prefix + key);
    },
    async clear(): Promise<void> {
      if (!hasStorage) return;
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    },
  };
}

