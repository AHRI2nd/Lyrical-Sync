class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

Object.defineProperty(globalThis, "Storage", {
  configurable: true,
  enumerable: true,
  value: MemoryStorage,
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  enumerable: true,
  value: new MemoryStorage(),
  writable: true,
});

export function installMemoryLocalStorage(): { storage: Storage; restore: () => void } {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };

  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: previousDescriptor?.enumerable ?? true,
    value: storage,
    writable: true,
  });

  let restored = false;
  return {
    storage,
    restore() {
      if (restored) return;
      restored = true;
      if (previousDescriptor) {
        Object.defineProperty(globalThis, "localStorage", previousDescriptor);
      } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    },
  };
}
