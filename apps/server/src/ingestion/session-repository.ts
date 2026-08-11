import {
  analyzeSession,
  classifySessionProject,
  type Pricing,
  type SessionSummary,
  type SourceChildLineage,
  type Span,
} from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import type { LoadedSourceSession, SourceRevision, StoredSessionRevision } from './types';

type PricingLookup = (model?: string, at?: number) => Pricing | undefined;

interface StoredSessionAggregate {
  id: string;
  name: string | null;
  filePath: string;
  agent: string;
  startTime: number;
  endTime: number | null;
  cwd: string | null;
  gitBranch: string | null;
  claudeVersion: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCost: number;
  costUnknownCount: number;
  costStatus: string;
  costCurrency: string | null;
  costCalculatedAt: number | null;
  costCalculatorVersion: string | null;
  peakContextTokens: number;
  avgContextTokens: number;
  cacheHitRate: number;
  messageCount: number;
  isReviewInitiator: number;
}

export class SessionRepository {
  private readonly getRevisionStatement;
  private readonly getAggregateStatement;
  private readonly hasSpanStatement;
  private readonly getAnnotationsStatement;
  private readonly upsertSessionStatement;
  private readonly deleteSpansStatement;
  private readonly deleteChildRelationshipsStatement;
  private readonly upsertSourceRelationshipStatement;
  private readonly deleteSessionStatement;
  private readonly insertSpanStatement;
  private readonly updateSpanEndStatement;
  private readonly replaceTransaction;
  private readonly appendTransaction;
  private readonly appendSessionStatement;
  private readonly refreshAverageContextStatement;
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
    this.getAggregateStatement = database.prepare(`
      SELECT id, name, file_path as filePath, agent, start_time as startTime,
        end_time as endTime, cwd, git_branch as gitBranch,
        claude_version as claudeVersion, input_tokens as inputTokens,
        cache_creation_tokens as cacheCreationTokens,
        cache_read_tokens as cacheReadTokens, output_tokens as outputTokens,
        total_cost as totalCost, cost_unknown_count as costUnknownCount,
        cost_status as costStatus,
        cost_currency as costCurrency, cost_calculated_at as costCalculatedAt,
        cost_calculator_version as costCalculatorVersion,
        peak_context_tokens as peakContextTokens, avg_context_tokens as avgContextTokens,
        cache_hit_rate as cacheHitRate, message_count as messageCount,
        is_review_initiator as isReviewInitiator
      FROM sessions WHERE id = ?
    `);
    this.hasSpanStatement = database.prepare(
      'SELECT 1 as present FROM spans WHERE session_id = ? AND id = ? LIMIT 1',
    );
    this.getAnnotationsStatement = database.prepare(
      'SELECT source_kind as sourceKind, tags, notes FROM sessions WHERE id = ?',
    );
    this.upsertSessionStatement = database.prepare(`
      INSERT INTO sessions (
        id, name, file_path, agent, file_mtime, file_size, file_lines,
        source_kind, source_updated_at, source_fingerprint, start_time, end_time,
        cwd, project_key, git_branch, claude_version, input_tokens, cache_creation_tokens,
        cache_read_tokens, output_tokens, total_cost, cost_unknown_count,
        cost_status, cost_currency, cost_calculated_at, cost_calculator_version,
        peak_context_tokens, avg_context_tokens, cache_hit_rate, message_count,
        is_review_initiator,
        imported_at
      ) VALUES (
        @id, @name, @filePath, @agent, @fileMtime, @fileSize, @fileLines,
        @sourceKind, @sourceUpdatedAt, @sourceFingerprint, @startTime, @endTime,
        @cwd, @projectKey, @gitBranch, @claudeVersion, @inputTokens, @cacheCreationTokens,
        @cacheReadTokens, @outputTokens, @totalCost, @costUnknownCount,
        @costStatus, @costCurrency, @costCalculatedAt, @costCalculatorVersion,
        @peakContextTokens, @avgContextTokens, @cacheHitRate, @messageCount,
        @isReviewInitiator,
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
        project_key = excluded.project_key,
        git_branch = excluded.git_branch,
        claude_version = excluded.claude_version,
        input_tokens = excluded.input_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        output_tokens = excluded.output_tokens,
        total_cost = excluded.total_cost,
        cost_unknown_count = excluded.cost_unknown_count,
        cost_status = excluded.cost_status,
        cost_currency = excluded.cost_currency,
        cost_calculated_at = excluded.cost_calculated_at,
        cost_calculator_version = excluded.cost_calculator_version,
        peak_context_tokens = excluded.peak_context_tokens,
        avg_context_tokens = excluded.avg_context_tokens,
        cache_hit_rate = excluded.cache_hit_rate,
        message_count = excluded.message_count,
        is_review_initiator = excluded.is_review_initiator,
        imported_at = excluded.imported_at
    `);
    this.deleteSpansStatement = database.prepare('DELETE FROM spans WHERE session_id = ?');
    this.deleteChildRelationshipsStatement = database.prepare(
      'DELETE FROM session_relationships WHERE child_session_id = ?',
    );
    this.upsertSourceRelationshipStatement = database.prepare(`
      INSERT INTO session_relationships (
        child_session_id, parent_session_id, source_kind, relation_kind,
        call_started_at, callback_at, callback_status,
        agent_nickname, agent_role, agent_path, updated_at
      ) VALUES (
        @childSessionId, @parentSessionId, @sourceKind, 'source_parent',
        @callStartedAt, @callbackAt, @callbackStatus,
        @agentNickname, @agentRole, @agentPath, @updatedAt
      )
      ON CONFLICT(child_session_id) DO UPDATE SET
        parent_session_id = excluded.parent_session_id,
        source_kind = excluded.source_kind,
        relation_kind = excluded.relation_kind,
        call_started_at = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.call_started_at
          ELSE COALESCE(excluded.call_started_at, session_relationships.call_started_at)
        END,
        callback_at = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.callback_at
          ELSE COALESCE(excluded.callback_at, session_relationships.callback_at)
        END,
        callback_status = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.callback_status
          WHEN excluded.callback_status = 'final_answer'
            THEN 'final_answer'
          ELSE COALESCE(excluded.callback_status, session_relationships.callback_status)
        END,
        agent_nickname = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.agent_nickname
          ELSE COALESCE(excluded.agent_nickname, session_relationships.agent_nickname)
        END,
        agent_role = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.agent_role
          ELSE COALESCE(excluded.agent_role, session_relationships.agent_role)
        END,
        agent_path = CASE
          WHEN session_relationships.parent_session_id <> excluded.parent_session_id
            OR session_relationships.source_kind <> excluded.source_kind
            THEN excluded.agent_path
          ELSE COALESCE(excluded.agent_path, session_relationships.agent_path)
        END,
        updated_at = excluded.updated_at
    `);
    this.deleteSessionStatement = database.prepare('DELETE FROM sessions WHERE id = ?');
    this.insertSpanStatement = database.prepare(`
      INSERT OR REPLACE INTO spans (
        id, session_id, parent_id, type, name, start_time, end_time,
        input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
        context_tokens, output_bytes, model, cost, cost_unknown, cost_currency,
        cost_status, pricing_effective_from, pricing_model, pricing_revision,
        cost_calculated_at, cost_calculator_version,
        stop_reason, is_error, is_sidechain, metadata
      ) VALUES (
        @id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
        @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens,
        @contextTokens, @outputBytes, @model, @cost, @costUnknown, @costCurrency,
        @costStatus, @pricingEffectiveFrom, @pricingModel, @pricingRevision,
        @costCalculatedAt, @costCalculatorVersion,
        @stopReason, @isError, @isSidechain, @metadata
      )
    `);
    this.updateSpanEndStatement = database.prepare(
      'UPDATE spans SET end_time = ? WHERE session_id = ? AND id = ?',
    );
    this.appendSessionStatement = database.prepare(`
      UPDATE sessions SET
        name = @name, file_mtime = @fileMtime, file_size = @fileSize,
        file_lines = @fileLines, source_kind = @sourceKind,
        source_updated_at = @sourceUpdatedAt, source_fingerprint = @sourceFingerprint,
        end_time = @endTime, cwd = @cwd, git_branch = @gitBranch,
        claude_version = @claudeVersion, input_tokens = @inputTokens,
        cache_creation_tokens = @cacheCreationTokens,
        cache_read_tokens = @cacheReadTokens, output_tokens = @outputTokens,
        total_cost = @totalCost, cost_unknown_count = @costUnknownCount,
        cost_status = @costStatus, cost_currency = @costCurrency,
        cost_calculated_at = @costCalculatedAt,
        cost_calculator_version = @costCalculatorVersion,
        peak_context_tokens = @peakContextTokens,
        avg_context_tokens = @avgContextTokens, cache_hit_rate = @cacheHitRate,
        message_count = @messageCount, is_review_initiator = @isReviewInitiator,
        imported_at = @importedAt
      WHERE id = @id
    `);
    this.refreshAverageContextStatement = database.prepare(`
      UPDATE sessions
      SET avg_context_tokens = COALESCE(
        (SELECT CAST(ROUND(AVG(context_tokens)) AS INTEGER)
         FROM spans WHERE session_id = ? AND type = 'llm_turn'), 0)
      WHERE id = ?
    `);
    this.replaceTransaction = database.transaction(
      (
        summary: SessionSummary,
        spans: Span[],
        revision: SourceRevision,
        sourceParentSessionId: string | undefined,
        sourceChildLineage: SourceChildLineage[],
        sourceAgentNickname: string | undefined,
        sourceAgentRole: string | undefined,
        sourceAgentPath: string | undefined,
        importedAt: number,
      ) => {
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
          projectKey: classifySessionProject(summary),
          gitBranch: summary.gitBranch ?? null,
          claudeVersion: summary.claudeVersion ?? null,
          inputTokens: summary.inputTokens,
          cacheCreationTokens: summary.cacheCreationTokens,
          cacheReadTokens: summary.cacheReadTokens,
          outputTokens: summary.outputTokens,
          totalCost: summary.totalCost,
          costUnknownCount: summary.costUnknownCount,
          costStatus: summary.costStatus,
          costCurrency: summary.costCurrency,
          costCalculatedAt: summary.costCalculatedAt,
          costCalculatorVersion: summary.costCalculatorVersion,
          peakContextTokens: summary.peakContextTokens,
          avgContextTokens: summary.avgContextTokens,
          cacheHitRate: summary.cacheHitRate,
          messageCount: summary.messageCount,
          isReviewInitiator: summary.isReviewInitiator ? 1 : 0,
          importedAt: summary.importedAt,
        });
        this.deleteSpansStatement.run(summary.id);
        for (const span of spans) {
          this.insertSpanStatement.run(toSpanRow(span));
        }
        if (sourceParentSessionId) {
          this.upsertSourceRelationshipStatement.run({
            childSessionId: summary.id,
            parentSessionId: sourceParentSessionId,
            sourceKind: revision.kind,
            callStartedAt: null,
            callbackAt: null,
            callbackStatus: null,
            agentNickname: sourceAgentNickname ?? null,
            agentRole: sourceAgentRole ?? null,
            agentPath: sourceAgentPath ?? null,
            updatedAt: importedAt,
          });
        }
        for (const child of sourceChildLineage) {
          const childSessionId = normalizedSourceParentSessionId(child.childSessionId, summary.id);
          if (!childSessionId) continue;
          this.upsertSourceRelationshipStatement.run({
            childSessionId,
            parentSessionId: summary.id,
            sourceKind: revision.kind,
            callStartedAt: child.callStartedAt ?? null,
            callbackAt: child.callbackAt ?? null,
            callbackStatus: child.callbackStatus ?? null,
            agentNickname: child.agentNickname ?? null,
            agentRole: child.agentRole ?? null,
            agentPath: child.agentPath ?? null,
            updatedAt: importedAt,
          });
        }
      },
    );
    this.appendTransaction = database.transaction(
      (
        existing: StoredSessionAggregate,
        summary: SessionSummary,
        spans: Span[],
        closeSpanIds: string[],
        closeAt: number,
        revision: SourceRevision,
        sourceParentSessionId: string | undefined,
        sourceAgentNickname: string | undefined,
        sourceAgentRole: string | undefined,
        sourceAgentPath: string | undefined,
        sourceChildLineage: SourceChildLineage[],
        importedAt: number,
      ) => {
        for (const span of spans) this.insertSpanStatement.run(toSpanRow(span));
        for (const spanId of closeSpanIds) {
          this.updateSpanEndStatement.run(closeAt, existing.id, spanId);
        }
        const inputTokens = existing.inputTokens + summary.inputTokens;
        const cacheCreationTokens = existing.cacheCreationTokens + summary.cacheCreationTokens;
        const cacheReadTokens = existing.cacheReadTokens + summary.cacheReadTokens;
        const outputTokens = existing.outputTokens + summary.outputTokens;
        const totalInput = inputTokens + cacheCreationTokens + cacheReadTokens;
        const endTime =
          summary.endTime !== undefined &&
          (existing.endTime === null || summary.endTime > existing.endTime)
            ? summary.endTime
            : existing.endTime;
        this.appendSessionStatement.run({
          id: existing.id,
          name: summary.name ?? existing.name,
          fileMtime: summary.fileMtime ?? null,
          fileSize: summary.fileSize ?? null,
          fileLines: summary.fileLines ?? null,
          sourceKind: revision.kind,
          sourceUpdatedAt: revision.updatedAt,
          sourceFingerprint: revision.fingerprint,
          endTime,
          cwd: summary.cwd ?? existing.cwd,
          gitBranch: summary.gitBranch ?? existing.gitBranch,
          claudeVersion: summary.claudeVersion ?? existing.claudeVersion,
          inputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          outputTokens,
          totalCost: existing.totalCost + summary.totalCost,
          costUnknownCount: existing.costUnknownCount + summary.costUnknownCount,
          costStatus: deriveAppendedCostStatus(existing.costStatus, summary.costStatus),
          costCurrency: summary.costCurrency ?? existing.costCurrency,
          costCalculatedAt: summary.costCalculatedAt ?? existing.costCalculatedAt,
          costCalculatorVersion: summary.costCalculatorVersion ?? existing.costCalculatorVersion,
          peakContextTokens: Math.max(existing.peakContextTokens, summary.peakContextTokens),
          avgContextTokens: existing.avgContextTokens,
          cacheHitRate: totalInput > 0 ? cacheReadTokens / totalInput : 0,
          messageCount: existing.messageCount + summary.messageCount,
          isReviewInitiator: existing.isReviewInitiator || summary.isReviewInitiator ? 1 : 0,
          importedAt,
        });
        this.refreshAverageContextStatement.run(existing.id, existing.id);
        if (sourceParentSessionId) {
          this.upsertSourceRelationshipStatement.run({
            childSessionId: existing.id,
            parentSessionId: sourceParentSessionId,
            sourceKind: revision.kind,
            callStartedAt: null,
            callbackAt: null,
            callbackStatus: null,
            agentNickname: sourceAgentNickname ?? null,
            agentRole: sourceAgentRole ?? null,
            agentPath: sourceAgentPath ?? null,
            updatedAt: importedAt,
          });
        }
        for (const child of sourceChildLineage) {
          const childSessionId = normalizedSourceParentSessionId(child.childSessionId, existing.id);
          if (!childSessionId) continue;
          this.upsertSourceRelationshipStatement.run({
            childSessionId,
            parentSessionId: existing.id,
            sourceKind: revision.kind,
            callStartedAt: child.callStartedAt ?? null,
            callbackAt: child.callbackAt ?? null,
            callbackStatus: child.callbackStatus ?? null,
            agentNickname: child.agentNickname ?? null,
            agentRole: child.agentRole ?? null,
            agentPath: child.agentPath ?? null,
            updatedAt: importedAt,
          });
        }
      },
    );
    this.removeTransaction = database.transaction((sessionId: string) => {
      this.deleteSpansStatement.run(sessionId);
      this.deleteChildRelationshipsStatement.run(sessionId);
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
      database.prepare('DELETE FROM session_relationships').run();
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
    this.replaceTransaction(
      summary,
      spans,
      revision,
      normalizedSourceParentSessionId(loaded.parsed.meta.sourceParentSessionId, summary.id),
      loaded.parsed.meta.sourceChildLineage ?? [],
      loaded.parsed.meta.sourceAgentNickname,
      loaded.parsed.meta.sourceAgentRole,
      loaded.parsed.meta.sourceAgentPath,
      importedAt,
    );
  }

  append(loaded: LoadedSourceSession, revision: SourceRevision, importedAt = Date.now()): boolean {
    const append = loaded.append;
    if (!append) return false;
    const existing = this.getAggregateStatement.get(loaded.parsed.sessionId) as
      | StoredSessionAggregate
      | undefined;
    if (!existing || !this.isCurrent(loaded.parsed.sessionId, append.baseRevision)) return false;
    if (
      loaded.parsed.spans.some(
        (span) => this.hasSpanStatement.get(existing.id, span.id) !== undefined,
      )
    ) {
      return false;
    }
    const { summary, spans } = analyzeSession(
      loaded.parsed,
      this.pricingLookup,
      loaded.fileMeta,
      importedAt,
    );
    this.appendTransaction(
      existing,
      summary,
      spans,
      append.closeSpanIds,
      append.closeAt,
      revision,
      normalizedSourceParentSessionId(loaded.parsed.meta.sourceParentSessionId, existing.id),
      loaded.parsed.meta.sourceAgentNickname,
      loaded.parsed.meta.sourceAgentRole,
      loaded.parsed.meta.sourceAgentPath,
      loaded.parsed.meta.sourceChildLineage ?? [],
      importedAt,
    );
    return true;
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

function normalizedSourceParentSessionId(
  value: string | undefined,
  sessionId: string,
): string | undefined {
  const parentId = value?.trim();
  return parentId && parentId !== sessionId ? parentId : undefined;
}

function deriveAppendedCostStatus(
  existing: string,
  appended: SessionSummary['costStatus'],
): string {
  if (existing === 'complete' && appended === 'complete') return 'complete';
  if (existing === 'excluded' && appended === 'excluded') return 'excluded';
  if (existing === 'not_captured' && appended === 'not_captured') return 'not_captured';
  return 'partial';
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
    costStatus: span.costStatus,
    costCurrency: span.costCurrency,
    pricingEffectiveFrom: span.pricingEffectiveFrom ?? null,
    pricingModel: span.pricingModel ?? null,
    pricingRevision: span.pricingRevision ?? null,
    costCalculatedAt: span.costCalculatedAt ?? null,
    costCalculatorVersion: span.costCalculatorVersion,
    stopReason: span.stopReason ?? null,
    isError: span.isError ? 1 : 0,
    isSidechain: span.isSidechain ? 1 : 0,
    metadata: span.metadata ? JSON.stringify(span.metadata) : null,
  };
}
