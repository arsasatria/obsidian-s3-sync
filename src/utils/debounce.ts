export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => fn(...args), delayMs);
  }) as T;
}
