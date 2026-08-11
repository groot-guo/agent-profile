import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile, stat as statAsync } from 'node:fs/promises';
import type { ParsedSession, TranscriptEntry } from '@agent-profile/core';
import {
  type CodexEntry,
  detectAgent,
  findTranscriptFiles,
  nonActionableCodexExternalHistoryId,
  parseCodexTranscript,
  parseTranscript,
  parseTranscriptText,
} from '@agent-profile/core';
import { type CodexStateMetadataIndex, loadCodexStateMetadataIndex } from './codex-state-metadata';
import type { SourceAdapter, SourceItem, SourceRevision } from './types';

const CODEX_PARSER_REVISION = 'codex-v8';
const MAX_CHECKPOINTS = 128;

interface TranscriptCheckpoint {
  agent: string;
  size: number;
  lineCount: number;
  prefixDigest: string;
  endsWithNewline: boolean;
  revision: SourceRevision;
  sessionId: string;
  lastTimestamp: string;
  closeSpanIds: string[];
  cwd?: string;
  claudeVersion?: string;
  sourceParentSessionId?: string;
}

const checkpoints = new Map<string, TranscriptCheckpoint>();

export class TranscriptSourceAdapter implements SourceAdapter {
  readonly kind = 'transcript';

  constructor(
    private readonly directory: string,
    private readonly agentOverride?: string,
    private readonly selectedFiles?: string[],
    private readonly options: { codexStateDatabasePath?: string } = {},
  ) {}

  async discover(): Promise<SourceItem[]> {
    const files = this.selectedFiles ?? (await findTranscriptFiles(this.directory));
    const agents = files.map((file) => this.agentOverride || detectAgent(file));
    const codexStateMetadata =
      agents.includes('codex') || this.options.codexStateDatabasePath !== undefined
        ? loadCodexStateMetadataIndex(this.options.codexStateDatabasePath)
        : undefined;
    const items: SourceItem[] = [];
    for (const [index, file] of files.entries()) {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      const agent = agents[index];
      const metadata = agent === 'codex' ? codexStateMetadata?.metadataFor(file) : undefined;
      const revision = buildRevision(agent, stat.mtimeMs, stat.size, metadata?.fingerprint);
      const checkpoint = checkpoints.get(file);

      items.push({
        key: file,
        sessionId: checkpoint?.sessionId,
        revision,
        load: async () => {
          const raw = await readFile(file);
          const currentStat = await statAsync(file);
          const currentMetadata =
            agent === 'codex' ? codexStateMetadata?.metadataFor(file) : undefined;
          const currentRevision = buildRevision(
            agent,
            currentStat.mtimeMs,
            currentStat.size,
            currentMetadata?.fingerprint,
          );
          const fullLoad = async () =>
            parseFull(
              raw,
              file,
              agent,
              currentStat.mtimeMs,
              currentStat.size,
              currentRevision,
              codexStateMetadata,
            );

          const append = tryAppend(
            raw,
            file,
            agent,
            currentStat.mtimeMs,
            currentRevision,
            checkpoint,
            codexStateMetadata,
          );
          if (append) {
            return {
              ...append,
              append: { ...append.append, fallback: fullLoad },
            };
          }
          return fullLoad();
        },
      });
    }
    return items;
  }
}

function buildRevision(
  agent: string,
  updatedAt: number,
  size: number,
  metadataFingerprint?: string,
): SourceRevision {
  return {
    kind: agent,
    updatedAt,
    fingerprint:
      agent === 'codex'
        ? `file:${CODEX_PARSER_REVISION}:${updatedAt}:${size}:${metadataFingerprint ?? 'none'}`
        : `file:${updatedAt}:${size}`,
    metadataFingerprint: agent === 'codex' ? metadataFingerprint : undefined,
  };
}

async function parseFull(
  raw: Buffer,
  file: string,
  agent: string,
  mtime: number,
  size: number,
  revision: SourceRevision,
  codexStateMetadata?: CodexStateMetadataIndex,
) {
  const parsedText = parseTranscriptText(raw.toString('utf8'));
  const entries = parsedText.entries;
  if (agent === 'codex') {
    const sessionId = nonActionableCodexExternalHistoryId(entries as unknown as CodexEntry[]);
    if (sessionId) {
      return {
        excluded: true as const,
        sessionId,
        reason: 'non_actionable_external_history' as const,
      };
    }
  }
  const parsed = parseEntries(entries, file, agent, undefined, codexStateMetadata);
  if (!parsed) return null;
  rememberCheckpoint(file, raw, entries, parsed, revision);
  return {
    parsed,
    fileMeta: { mtime, size, lines: entries.length },
  };
}

function tryAppend(
  raw: Buffer,
  file: string,
  agent: string,
  mtime: number,
  revision: SourceRevision,
  checkpoint: TranscriptCheckpoint | undefined,
  codexStateMetadata?: CodexStateMetadataIndex,
) {
  if (!checkpoint || checkpoint.agent !== agent || raw.length <= checkpoint.size) return null;
  if (
    agent === 'codex' &&
    checkpoint.revision.metadataFingerprint !== revision.metadataFingerprint
  ) {
    return null;
  }
  if (!checkpoint.endsWithNewline) return null;
  if (digest(raw.subarray(0, checkpoint.size)) !== checkpoint.prefixDigest) return null;

  const suffixText = raw.subarray(checkpoint.size).toString('utf8');
  const parsedSuffixText = parseTranscriptText(suffixText);
  if (
    parsedSuffixText.malformedLines > 0 ||
    parsedSuffixText.untypedLines > 0 ||
    parsedSuffixText.entries.length === 0
  ) {
    return null;
  }
  const suffix = parsedSuffixText.entries;
  if (
    checkpoint.lastTimestamp &&
    suffix.some((entry) => entry.timestamp && entry.timestamp < checkpoint.lastTimestamp)
  ) {
    return null;
  }

  if (agent !== 'codex' && suffix.some(hasToolResult)) return null;
  if (agent === 'codex' && !isIndependentCodexTurn(suffix as unknown as CodexEntry[])) return null;

  const parsed = parseEntries(suffix, file, agent, checkpoint, codexStateMetadata);
  if (!parsed) return null;
  const closeAt = firstTimestamp(suffix);
  if (closeAt === undefined) return null;

  const nextCheckpoint = updateCheckpoint(checkpoint, raw, suffix, parsed, revision);
  checkpoints.delete(file);
  rememberCheckpointValue(file, nextCheckpoint);

  return {
    parsed,
    fileMeta: { mtime, size: raw.length, lines: nextCheckpoint.lineCount },
    append: {
      baseRevision: checkpoint.revision,
      closeSpanIds: checkpoint.closeSpanIds,
      closeAt,
    },
  };
}

function parseEntries(
  entries: TranscriptEntry[],
  file: string,
  agent: string,
  checkpoint?: TranscriptCheckpoint,
  codexStateMetadata?: CodexStateMetadataIndex,
): ParsedSession | null {
  if (agent === 'codex') {
    const sessionId = checkpoint?.sessionId ?? codexSessionId(entries as unknown as CodexEntry[]);
    const metadata = codexStateMetadata?.metadataFor(file, sessionId);
    return parseCodexTranscript(entries as unknown as CodexEntry[], {
      filePath: file,
      sessionId,
      cwd: checkpoint?.cwd,
      claudeVersion: checkpoint?.claudeVersion,
      sourceParentSessionId: checkpoint?.sourceParentSessionId ?? metadata?.sourceParentSessionId,
      sourceTitle: metadata?.title,
      sourceAgentNickname: metadata?.agentNickname,
      sourceAgentRole: metadata?.agentRole,
      sourceAgentPath: metadata?.agentPath,
      sourceChildMetadata: metadata?.sourceChildMetadata,
    });
  }
  return parseTranscript(entries, {
    filePath: file,
    agent,
    sessionId: checkpoint?.sessionId,
  });
}

function codexSessionId(entries: CodexEntry[]): string | undefined {
  const meta = entries.find((entry) => entry.type === 'session_meta')?.payload as
    | Record<string, unknown>
    | undefined;
  return (
    (typeof meta?.id === 'string' ? meta.id : undefined) ??
    (typeof meta?.session_id === 'string' ? meta.session_id : undefined)
  );
}

function isIndependentCodexTurn(entries: CodexEntry[]): boolean {
  const firstMeaningful = entries.find((entry) => entry.type !== 'session_meta');
  if (firstMeaningful?.type !== 'turn_context') return false;
  const calls = new Set(
    entries
      .filter(
        (entry) => entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call',
      )
      .map((entry) => entry.payload?.call_id)
      .filter((callId): callId is string => typeof callId === 'string'),
  );
  return !entries.some(
    (entry) =>
      entry.type === 'response_item' &&
      entry.payload?.type === 'custom_tool_call_output' &&
      !calls.has(typeof entry.payload.call_id === 'string' ? entry.payload.call_id : ''),
  );
}

function hasToolResult(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user' || !entry.message || !Array.isArray(entry.message.content)) {
    return false;
  }
  return (entry.message.content as unknown[]).some(
    (block) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_result',
  );
}

function rememberCheckpoint(
  file: string,
  raw: Buffer,
  entries: TranscriptEntry[],
  parsed: ParsedSession,
  revision: SourceRevision,
): void {
  const lastTimestamp = entries.reduce(
    (latest, entry) => (entry.timestamp > latest ? entry.timestamp : latest),
    '',
  );
  const lastTurn = parsed.spans
    .filter((span) => span.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime)
    .at(-1);
  const closeSpanIds = lastTurn
    ? parsed.spans
        .filter(
          (span) =>
            (span.id === lastTurn.id || span.parentId === lastTurn.id) &&
            span.endTime === undefined,
        )
        .map((span) => span.id)
    : [];
  rememberCheckpointValue(file, {
    agent: parsed.meta.agent,
    size: raw.length,
    lineCount: entries.length,
    prefixDigest: digest(raw),
    endsWithNewline: raw[raw.length - 1] === 10,
    revision,
    sessionId: parsed.sessionId,
    lastTimestamp,
    closeSpanIds,
    cwd: parsed.meta.cwd,
    claudeVersion: parsed.meta.claudeVersion,
    sourceParentSessionId: parsed.meta.sourceParentSessionId,
  });
}

function updateCheckpoint(
  checkpoint: TranscriptCheckpoint,
  raw: Buffer,
  suffix: TranscriptEntry[],
  parsed: ParsedSession,
  revision: SourceRevision,
): TranscriptCheckpoint {
  const lastTimestamp = suffix.reduce(
    (latest, entry) => (entry.timestamp > latest ? entry.timestamp : latest),
    checkpoint.lastTimestamp,
  );
  const lastTurn = parsed.spans
    .filter((span) => span.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime)
    .at(-1);
  return {
    ...checkpoint,
    size: raw.length,
    lineCount: checkpoint.lineCount + suffix.length,
    prefixDigest: digest(raw),
    endsWithNewline: raw[raw.length - 1] === 10,
    revision,
    lastTimestamp,
    closeSpanIds: lastTurn
      ? parsed.spans
          .filter(
            (span) =>
              (span.id === lastTurn.id || span.parentId === lastTurn.id) &&
              span.endTime === undefined,
          )
          .map((span) => span.id)
      : checkpoint.closeSpanIds,
    cwd: parsed.meta.cwd ?? checkpoint.cwd,
    claudeVersion: parsed.meta.claudeVersion ?? checkpoint.claudeVersion,
    sourceParentSessionId: parsed.meta.sourceParentSessionId ?? checkpoint.sourceParentSessionId,
  };
}

function rememberCheckpointValue(file: string, checkpoint: TranscriptCheckpoint): void {
  checkpoints.delete(file);
  checkpoints.set(file, checkpoint);
  while (checkpoints.size > MAX_CHECKPOINTS) {
    const oldest = checkpoints.keys().next().value;
    if (!oldest) break;
    checkpoints.delete(oldest);
  }
}

function firstTimestamp(entries: TranscriptEntry[]): number | undefined {
  const timestamps = entries
    .map((entry) => Date.parse(entry.timestamp))
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.min(...timestamps) : undefined;
}

function digest(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}
