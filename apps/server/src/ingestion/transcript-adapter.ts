import { statSync } from 'node:fs';
import {
  type CodexEntry,
  detectAgent,
  findTranscriptFiles,
  parseCodexTranscript,
  parseTranscript,
  readTranscript,
} from '@agent-profile/core';
import type { SourceAdapter, SourceItem } from './types';

export class TranscriptSourceAdapter implements SourceAdapter {
  readonly kind = 'transcript';

  constructor(
    private readonly directory: string,
    private readonly agentOverride?: string,
  ) {}

  async discover(): Promise<SourceItem[]> {
    const files = await findTranscriptFiles(this.directory);
    return files.map((file) => {
      const stat = statSync(file);
      const agent = this.agentOverride || detectAgent(file);
      const revision = {
        kind: agent,
        updatedAt: stat.mtimeMs,
        fingerprint: `file:${stat.mtimeMs}:${stat.size}`,
      };

      return {
        key: file,
        revision,
        load: async () => {
          const entries = await readTranscript(file);
          const parsed =
            agent === 'codex'
              ? parseCodexTranscript(entries as unknown as CodexEntry[], { filePath: file })
              : parseTranscript(entries, { filePath: file, agent });
          if (!parsed) return null;
          return {
            parsed,
            fileMeta: {
              mtime: stat.mtimeMs,
              size: stat.size,
              lines: entries.length,
            },
          };
        },
      };
    });
  }
}
