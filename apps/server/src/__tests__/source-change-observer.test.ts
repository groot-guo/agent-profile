import { describe, expect, it, vi } from 'vitest';
import { SourceChangeObserver, type WatchFactory } from '../ingestion/source-change-observer';

describe('Source change observer', () => {
  it('debounces accepted changes and serializes a change received during import', async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (eventType: string, filename: string | null) => void>();
      const close = vi.fn();
      const watch: WatchFactory = (path, _options, listener) => {
        listeners.set(path, listener);
        return { close };
      };
      let finishImport: (() => void) | undefined;
      const onChange = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishImport = resolve;
            }),
        )
        .mockResolvedValue(undefined);
      const observer = new SourceChangeObserver({
        sources: [
          {
            id: 'codex',
            path: '/sessions',
            recursive: true,
            accepts: (filename) =>
              filename.endsWith('.jsonl') && !filename.endsWith('journal.jsonl'),
            includeChangedPath: true,
          },
        ],
        onChange,
        watch,
        debounceMs: 100,
        cooldownMs: 500,
        clock: () => Date.now(),
      });
      observer.start();

      listeners.get('/sessions')?.('change', 'a.jsonl');
      listeners.get('/sessions')?.('change', 'a.jsonl');
      listeners.get('/sessions')?.('change', 'journal.jsonl');
      listeners.get('/sessions')?.('change', '../outside.jsonl');
      await vi.advanceTimersByTimeAsync(100);
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith({
        sourceId: 'codex',
        changedPath: '/sessions/a.jsonl',
      });

      listeners.get('/sessions')?.('change', 'b.jsonl');
      await vi.advanceTimersByTimeAsync(600);
      expect(onChange).toHaveBeenCalledOnce();
      finishImport?.();
      await vi.advanceTimersByTimeAsync(500);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith({
        sourceId: 'codex',
        changedPath: '/sessions/b.jsonl',
      });

      await observer.close();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
