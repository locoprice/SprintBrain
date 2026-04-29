// Single source of artificial latency for mock services.
// Keeps loading skeletons and async UX paths exercised in dev.
const DEFAULT_MS = 150;

export function delay<T>(value: T, ms: number = DEFAULT_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}
