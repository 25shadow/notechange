export type RetryOptions = {
  delays?: number[];
  sleep?: (milliseconds: number) => Promise<void>;
};

const transientErrors = new Set(['NETWORK_TRANSIENT', 'RATE_LIMITED']);

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const delays = options.delays ?? [1000, 2000, 4000, 8000];
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classification = error instanceof Error ? error.message : 'UNKNOWN';
      if (!transientErrors.has(classification) || attempt >= delays.length) throw error;
      await sleep(delays[attempt] ?? 0);
    }
  }
}
