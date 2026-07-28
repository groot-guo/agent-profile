import { analyzeSession, type Pricing, type SessionSummary, type Span } from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import type { LoadedSourceSession, SourceRevision, StoredSessionRevision } from './types';

type PricingLookup = (model?: string, at?: number) => Pricing | undefined;

export class SessionRepository {
  private readonly getRevisionStatement;
  private readonly getAnnotationsStatement;
  private readonly upsertSessionStatement;
  private readonly deleteSpansStatement;
  private readonly deleteSessionStatement;
  private readonly insertSpanStatement;
  private readonly replaceTransaction;
  private readonly removeTransaction;
  private readonly resetTransaction;

  constructor(
    database: DatabaseConnection,
    private readonly pricingLookup: PricingLookup,
  ) {
    this.getRevisionStatement = database.prepare(`
      SELECT source_kind as kind, source_updated_at as updatedAt,
        source_fingerprint as fingerprint
      FROM sessions
      WHERE id = ?
    `);
    this.getAnnotationsStatement = database.prepare(
      'SELECT source_kind as sourceKind, tags, notes FROM sessions WHERE id = ?',
    );
    this.upsertSessionStatement = database.prepare(`
      INSERT INTO sessions (
        id, name, file_path, agent, file_mtime, file_size, file_lines,
        source_kind, source_updated_at, source_fingerprint, start_time, end_time,
        cwd, git_branch, claude_version, input_tokens, cache_creation_tokens,
        cache_read_tokens, output_tokens, total_cost, cost_unknown_count,
        cost_currency, cost_calculated_at, cost_calculator_version,
        peak_context_tokens, avg_context_tokens, cache_hit_rate, message_count,
        imported_at
      ) VALUES (
        @id, @name, @filePath, @agent, @fileMtime, @fileSize, @fileLines,
        @sourceKind, @sourceUpdatedAt, @sourceFingerprint, @startTime, @endTime,
        @cwd, @gitBranch, @claudeVersion, @inputTokens, @cacheCreationTokens,
        @cacheReadTokens, @outputTokens, @totalCost, @costUnknownCount,
        @costCurrency, @costCalculatedAt, @costCalculatorVersion,
        @peakContextTokens, @avgContextTokens, @cacheHitRate, @messageCount,
        @importedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        file_path = excluded.file_path,
        agent = excluded.agent,
        file_mtime = excluded.file_mtime,
        file_size = excluded.file_size,
        file_lines = excluded.file_lines,
        source_kind = excluded.source_kind,
        source_updated_at = excluded.source_updated_at,
        source_fingerprint = excluded.source_fingerprint,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        cwd = excluded.cwd,
        git_branch = excluded.git_branch,
        claude_version = excluded.claude_version,
        input_tokens = excluded.input_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        output_tokens = excluded.output_tokens,
        total_cost = excluded.total_cost,
        cost_unknown_count = excluded.cost_unknown_count,
        cost_currency = excluded.cost_currency,
        cost_calculated_at = excluded.cost_calculated_at,
        cost_calculator_version = excluded.cost_calculator_version,
        peak_context_tokens = excluded.peak_context_tokens,
        avg_context_tokens = excluded.avg_context_tokens,
        cache_hit_rate = excluded.cache_hit_rate,
        message_count = excluded.message_count,
        imported_at = excluded.imported_at
    `);
    this.deleteSpansStatement = database.prepare('DELETE FROM spans WHERE session_id = ?');
    this.deleteSessionStatement = database.prepare('DELETE FROM sessions WHERE id = ?');
    this.insertSpanStatement = database.prepare(`
      INSERT OR REPLACE INTO spans (
        id, session_id, parent_id, type, name, start_time, end_time,
        input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
        context_tokens, output_bytes, model, cost, cost_unknown, cost_currency,
        pricing_effective_from, cost_calculated_at, cost_calculator_version,
        stop_reason, is_error, is_sidechain, metadata
      ) VALUES (
        @id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
        @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens,
        @contextTokens, @outputBytes, @model, @cost, @costUnknown, @costCurrency,
        @pricingEffectiveFrom, @costCalculatedAt, @costCalculatorVersion,
        @stopReason, @isError, @isSidechain, @metadata
      )
    `);
    this.replaceTransaction = database.transaction(
      (summary: SessionSummary, spans: Span[], revision: SourceRevision) => {
        this.upsertSessionStatement.run({
          id: summary.id,
          name: summary.name ?? null,
          filePath: summary.filePath,
          agent: summary.agent,
          fileMtime: summary.fileMtime ?? null,
          fileSize: summary.fileSize ?? null,
          fileLines: summary.fileLines ?? null,
          sourceKind: revision.kind,
          sourceUpdatedAt: revision.updatedAt,
          sourceFingerprint: revision.fingerprint,
          startTime: summary.startTime,
          endTime: summary.endTime ?? null,
          cwd: summary.cwd ?? null,
          gitBranch: summary.gitBranch ?? null,
          claudeVersion: summary.claudeVersion ?? null,
          inputTokens: summary.inputTokens,
          cacheCreationTokens: summary.cacheCreationTokens,
          cacheReadTokens: summary.cacheReadTokens,
          outputTokens: summary.outputTokens,
          totalCost: summary.totalCost,
          costUnknownCount: summary.costUnknownCount,
          costCurrency: summary.costCurrency,
          costCalculatedAt: summary.costCalculatedAt,
          costCalculatorVersion: summary.costCalculatorVersion,
          peakContextTokens: summary.peakContextTokens,
          avgContextTokens: summary.avgContextTokens,
          cacheHitRate: summary.cacheHitRate,
          messageCount: summary.messageCount,
          importedAt: summary.importedAt,
        });
        this.deleteSpansStatement.run(summary.id);
        for (const span of spans) {
          this.insertSpanStatement.run(toSpanRow(span));
        }
      },
    );
    this.removeTransaction = database.transaction((sessionId: string) => {
      this.deleteSpansStatement.run(sessionId);
      this.deleteSessionStatement.run(sessionId);
    });
    this.resetTransaction = database.transaction(() => {
      const counts = {
        sessions: (
          database.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
        ).count,
        spans: (database.prepare('SELECT COUNT(*) as count FROM spans').get() as { count: number })
          .count,
        annotatedSessions: (
          database
            .prepare(
              "SELECT COUNT(*) as count FROM sessions WHERE TRIM(COALESCE(tags, '')) <> '' OR TRIM(COALESCE(notes, '')) <> ''",
            )
            .get() as { count: number }
        ).count,
      };
      database.prepare('DELETE FROM spans').run();
      database.prepare('DELETE FROM sessions').run();
      return counts;
    });
  }

  getRevision(sessionId: string): StoredSessionRevision {
    const row = this.getRevisionStatement.get(sessionId) as
      | {
          kind: string | null;
          updatedAt: number | null;
          fingerprint: string | null;
        }
      | undefined;
    if (!row) return { exists: false };
    return {
      exists: true,
      kind: row.kind ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
      fingerprint: row.fingerprint ?? undefined,
    };
  }

  isCurrent(sessionId: string, revision: SourceRevision): boolean {
    const stored = this.getRevision(sessionId);
    return (
      stored.exists && stored.kind === revision.kind && stored.fingerprint === revision.fingerprint
    );
  }

  replace(loaded: LoadedSourceSession, revision: SourceRevision, importedAt = Date.now()): void {
    const { summary, spans } = analyzeSession(
      loaded.parsed,
      this.pricingLookup,
      loaded.fileMeta,
      importedAt,
    );
    this.replaceTransaction(summary, spans, revision);
  }

  removeGeneratedIfUnannotated(
    sessionId: string,
    sourceKind: string,
  ): 'missing' | 'different_source' | 'annotated' | 'removed' {
    const row = this.getAnnotationsStatement.get(sessionId) as
      | { sourceKind: string | null; tags: string | null; notes: string | null }
      | undefined;
    if (!row) return 'missing';
    if (row.sourceKind !== sourceKind) return 'different_source';
    if ((row.tags ?? '').trim() || (row.notes ?? '').trim()) return 'annotated';
    this.removeTransaction(sessionId);
    return 'removed';
  }

  resetGeneratedData(): { sessions: number; spans: number; annotatedSessions: number } {
    return this.resetTransaction();
  }
}

function toSpanRow(span: Span) {
  return {
    id: span.id,
    sessionId: span.sessionId,
    parentId: span.parentId ?? null,
    type: span.type,
    name: span.name,
    startTime: span.startTime,
    endTime: span.endTime ?? null,
    inputTokens: span.inputTokens,
    cacheCreationTokens: span.cacheCreationTokens,
    cacheReadTokens: span.cacheReadTokens,
    outputTokens: span.outputTokens,
    contextTokens: span.contextTokens,
    outputBytes: span.outputBytes,
    model: span.model ?? null,
    cost: span.cost,
    costUnknown: span.costUnknown ? 1 : 0,
    costCurrency: span.costCurrency,
    pricingEffectiveFrom: span.pricingEffectiveFrom ?? null,
    costCalculatedAt: span.costCalculatedAt ?? null,
    costCalculatorVersion: span.costCalculatorVersion,
    stopReason: span.stopReason ?? null,
    isError: span.isError ? 1 : 0,
    isSidechain: span.isSidechain ? 1 : 0,
    metadata: span.metadata ? JSON.stringify(span.metadata) : null,
  };
}
