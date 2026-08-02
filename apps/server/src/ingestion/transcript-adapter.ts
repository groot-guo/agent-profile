import { statSync } from 'node:fs';
import {
  type CodexEntry,
  detectAgent,
  findTranscriptFiles,
  nonActionableCodexExternalHistoryId,
  parseCodexTranscript,
  parseTranscript,
  readTranscript,
} from '@agent-profile/core';
import type { SourceAdapter, SourceItem } from './types';

const CODEX_PARSER_REVISION = 'codex-v4';

export class TranscriptSourceAdapter implements SourceAdapter {
  readonly kind = 'transcript';

  constructor(
    private readonly directory: string,
    private readonly agentOverride?: string,
    private readonly selectedFiles?: string[],
  ) {}

  async discover(): Promise<SourceItem[]> {
    const files = this.selectedFiles ?? (await findTranscriptFiles(this.directory));
    const items: SourceItem[] = [];
    for (const file of files) {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      const agent = this.agentOverride || detectAgent(file);
      const revision = {
        kind: agent,
        updatedAt: stat.mtimeMs,
        fingerprint:
          agent === 'codex'
            ? `file:${CODEX_PARSER_REVISION}:${stat.mtimeMs}:${stat.size}`
            : `file:${stat.mtimeMs}:${stat.size}`,
      };

      items.push({
        key: file,
        revision,
        load: async () => {
          const entries = await readTranscript(file);
          if (agent === 'codex') {
            const sessionId = nonActionableCodexExternalHistoryId(
              entries as unknown as CodexEntry[],
            );
            if (sessionId) {
              return {
                excluded: true,
                sessionId,
                reason: 'non_actionable_external_history' as const,
              };
            }
          }
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
      });
    }
    return items;
  }
}
