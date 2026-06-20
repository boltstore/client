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

/** File-system store for Node.js and Bun. Creates JSON files in the given directory. */
export async function createFileStore(dir: string): Promise<SyncStore> {
  const { fs, path } = await loadFsModules();

  function filePath(key: string): string {
    return path.join(dir, `${key}.json`);
  }

  return {
    async get(key: string): Promise<string | null> {
      try {
        return fs.readFileSync(filePath(key), "utf-8");
      } catch {
        return null;
      }
    },
    async set(key: string, value: string): Promise<void> {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath(key), value, "utf-8");
    },
    async remove(key: string): Promise<void> {
      try {
        fs.unlinkSync(filePath(key));
      } catch { /* ok */ }
    },
    async clear(): Promise<void> {
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    },
  };
}

async function loadFsModules(): Promise<{ fs: typeof import("node:fs"); path: typeof import("node:path") }> {
  try {
    const [fs, path] = await Promise.all([
      import("node:fs") as Promise<typeof import("node:fs")>,
      import("node:path") as Promise<typeof import("node:path")>,
    ]);
    return { fs, path };
  } catch {
    throw new Error(
      "@boltstore/client: createFileStore requires Node.js or Bun. " +
      "On other platforms, use InMemoryStore, createWebStore, or provide a custom SyncStore."
    );
  }
}
