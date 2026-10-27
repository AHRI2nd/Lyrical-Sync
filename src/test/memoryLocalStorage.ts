class MemoryLocalStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "Storage", {
  configurable: true,
  enumerable: true,
  value: MemoryLocalStorage,
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  enumerable: true,
  value: new MemoryLocalStorage(),
  writable: true,
});
