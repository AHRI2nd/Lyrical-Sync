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
