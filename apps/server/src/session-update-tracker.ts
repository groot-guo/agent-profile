import type { SessionUpdatesResponse } from '@agent-profile/contracts';

interface SessionUpdateEvent {
  version: number;
  sessionIds: string[];
  reset: boolean;
}

interface SessionUpdateTrackerOptions {
  clock?: () => number;
  historyLimit?: number;
  sessionLimit?: number;
}

interface UpdateWaiter {
  after: number;
  resolve: (response: SessionUpdatesResponse) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}

export class SessionUpdateTracker {
  private readonly clock: () => number;
  private readonly historyLimit: number;
  private readonly sessionLimit: number;
  private readonly events: SessionUpdateEvent[] = [];
  private readonly waiters = new Set<UpdateWaiter>();
  private version = 0;

  constructor(options: SessionUpdateTrackerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.historyLimit = Math.max(1, options.historyLimit ?? 64);
    this.sessionLimit = Math.max(1, options.sessionLimit ?? 100);
  }

  publish(sessionIds: string[], reset = false): void {
    const uniqueIds = [...new Set(sessionIds)].slice(0, this.sessionLimit);
    const isTruncated = uniqueIds.length < new Set(sessionIds).size;
    if (uniqueIds.length === 0 && !reset) return;

    this.version++;
    this.events.push({ version: this.version, sessionIds: uniqueIds, reset: reset || isTruncated });
    if (this.events.length > this.historyLimit) this.events.shift();
    this.flushWaiters();
  }

  waitFor(after: number, waitMs: number, signal?: AbortSignal): Promise<SessionUpdatesResponse> {
    if (this.version > after || waitMs <= 0) return Promise.resolve(this.snapshot(after));
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const waiter: UpdateWaiter = {
        after,
        resolve,
        reject,
        timer: setTimeout(() => this.finish(waiter, this.snapshot(after)), waitMs),
        signal,
      };
      if (signal) {
        waiter.abort = () => this.fail(waiter, abortError());
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }

  close(): void {
    for (const waiter of [...this.waiters]) this.finish(waiter, this.snapshot(waiter.after));
  }

  private snapshot(after: number): SessionUpdatesResponse {
    const firstVersion = this.events[0]?.version ?? this.version + 1;
    const relevant = this.events.filter((event) => event.version > after);
    const reset = after < firstVersion - 1 || relevant.some((event) => event.reset);
    const allSessionIds = new Set(relevant.flatMap((event) => event.sessionIds));
    const sessionIds = [...allSessionIds].slice(0, this.sessionLimit);
    return {
      version: this.version,
      observedAt: this.clock(),
      reset: reset || allSessionIds.size > sessionIds.length,
      sessionIds,
    };
  }

  private flushWaiters(): void {
    for (const waiter of [...this.waiters]) {
      if (this.version > waiter.after) this.finish(waiter, this.snapshot(waiter.after));
    }
  }

  private finish(waiter: UpdateWaiter, response: SessionUpdatesResponse): void {
    this.cleanup(waiter);
    waiter.resolve(response);
  }

  private fail(waiter: UpdateWaiter, error: unknown): void {
    this.cleanup(waiter);
    waiter.reject(error);
  }

  private cleanup(waiter: UpdateWaiter): void {
    if (!this.waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
  }
}

function abortError(): DOMException {
  return new DOMException('Session update wait aborted', 'AbortError');
}
