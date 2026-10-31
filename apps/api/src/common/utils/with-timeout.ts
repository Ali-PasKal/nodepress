export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError if `operation` does not settle within `timeoutMs`. */
export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
