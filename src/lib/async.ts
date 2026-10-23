import i18n from "@/i18n";

/** Maximum simultaneous uploads. */
export const UPLOAD_CONCURRENCY = 6;

/** Retry a network step a couple of times before giving up. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(i18n.t("viewer.errors.uploadFailed"));
}

/**
 * Run `task` for every item with a bounded number of parallel workers.
 * Results keep the original order; the first failure aborts the pool.
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onDone?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await task(items[i]!, i);
      done++;
      onDone?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}
