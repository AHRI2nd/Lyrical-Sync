const pending = new Map<string, Promise<unknown>>();

// Exact destination keys only; filesystem aliases need separate conflict checks.
export function enqueuePathWrite<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = pending.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  pending.set(path, next);
  void next.finally(() => {
    if (pending.get(path) === next) pending.delete(path);
  }).catch(() => {});
  return next;
}
