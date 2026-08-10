import {
  type DiagnosisResult,
  diagnoseSession,
  diagnoseSessionSync,
  type SemanticDiagnosisReport,
  type SessionDetail,
  type SessionSummary,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import {
  createSemanticDiagnosisAuditStore,
  type SemanticDiagnoser,
  type SemanticDiagnosisAuditStore,
} from '../llm-diagnoser';
import type { AppRuntime } from '../runtime';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

type DiagnosisRuntime = Pick<AppRuntime, 'pricingResolver' | 'contextWindowResolver'> & {
  provider?: AppRuntime['provider'];
};
type DiagnosisRouteRuntime = Pick<
  AppRuntime,
  'clock' | 'database' | 'pricingResolver' | 'contextWindowResolver'
> & {
  provider?: AppRuntime['provider'];
  auditStore?: SemanticDiagnosisAuditStore;
};

interface DiagnoseDetailOptions {
  semanticOptIn?: boolean;
  semanticDiagnoser?: SemanticDiagnoser | null;
  auditStore?: SemanticDiagnosisAuditStore;
  clock?: () => number;
}

interface DiagnosisQuery {
  semantic?: 'opt_in';
}

const diagnosisQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    semantic: { type: 'string', enum: ['opt_in'] },
  },
} as const;

const emptyPayload: SemanticDiagnosisReport['payload'] = {
  mode: 'not_sent',
  thinkingItems: 0,
  toolItems: 0,
  characters: 0,
  redactions: 0,
  rawContentIncluded: false,
};

export async function diagnoseDetail(
  detail: SessionDetail,
  runtime: DiagnosisRuntime,
  options: DiagnoseDetailOptions = {},
): Promise<DiagnosisResult> {
  const pricingOptions = {
    // Diagnosis estimates are planning-time input-price upper bounds; the
    // analyzer/import path separately persists span-time cost provenance.
    pricingLookup: runtime.pricingResolver,
    contextWindowLookup: runtime.contextWindowResolver,
  };
  const base = diagnoseSessionSync(detail, pricingOptions);
  if (options.semanticOptIn !== true) {
    return { ...base, semantic: notRequestedSemanticReport() };
  }

  const diagnoser = options.semanticDiagnoser ?? runtime.provider?.diagnoser() ?? null;
  if (!diagnoser) {
    const semantic = notConfiguredSemanticReport();
    recordAudit(detail.id, semantic, options);
    return { ...base, semantic };
  }

  // 证据不足时抑制语义结论：若没有任何可观察的 LLM turn 遥测（token 未捕获
  // 或 stub turn），语义推断无法基于结构证据，必须报告证据不足而不是猜测。
  const llmTurns = detail.spans.filter((span) => span.type === 'llm_turn');
  const hasObservedEvidence = llmTurns.some(
    (turn) =>
      turn.metadata?.tokenUsageSource !== undefined &&
      turn.metadata?.tokenUsageSource !== 'not_captured',
  );
  if (!hasObservedEvidence && llmTurns.length > 0) {
    const semantic = evidenceInsufficientSemanticReport();
    recordAudit(detail.id, semantic, options);
    return { ...base, semantic };
  }

  const result = await diagnoseSession(detail, { ...pricingOptions, llmDiagnoser: diagnoser });
  const semantic = result.semantic ?? failedSemanticReport(diagnoser.provider);
  recordAudit(detail.id, semantic, options);
  return { ...result, semantic: { ...semantic, audit: { ...semantic.audit, recorded: true } } };
}

export function registerDiagnosisRoutes(
  app: FastifyInstance,
  runtime: DiagnosisRouteRuntime,
): void {
  const { database } = runtime;
  const auditStore = runtime.auditStore ?? createSemanticDiagnosisAuditStore();
  app.get<{ Params: { id: string }; Querystring: DiagnosisQuery }>(
    '/api/session/:id/diagnosis',
    { schema: { querystring: diagnosisQuerySchema } },
    async (req, reply) => {
      const session = database
        .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
        .get(req.params.id) as SessionSummary | undefined;
      if (!session) return reply.status(404).send({ error: 'session not found' });
      const rows = database
        .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
        .all(req.params.id) as Record<string, unknown>[];
      const detail = { ...session, spans: rows.map(parseSpanRow) } as SessionDetail;

      return diagnoseDetail(detail, runtime, {
        semanticOptIn: req.query.semantic === 'opt_in',
        semanticDiagnoser: runtime.provider?.diagnoser() ?? null,
        auditStore,
        clock: runtime.clock,
      });
    },
  );
}

function recordAudit(
  sessionId: string,
  semantic: SemanticDiagnosisReport,
  options: DiagnoseDetailOptions,
): void {
  if (!options.auditStore || options.semanticOptIn !== true) return;
  const requestedAt = options.clock?.() ?? Date.now();
  options.auditStore.record({
    sessionId,
    requestedAt,
    completedAt: options.clock?.() ?? Date.now(),
    status: semantic.status,
    provider: semantic.provider,
    payload: semantic.payload,
  });
}

function notRequestedSemanticReport(): SemanticDiagnosisReport {
  return {
    requested: false,
    consent: 'not_granted',
    status: 'not_requested',
    provider: null,
    payload: emptyPayload,
    audit: {
      recorded: false,
      retention: 'process_bounded_content_free',
      rawContentStored: false,
    },
    limitations: [
      'Deterministic diagnosis is returned by default; no semantic Provider call was made.',
      'Semantic diagnosis requires an explicit request-scoped semantic=opt_in parameter.',
    ],
  };
}

function notConfiguredSemanticReport(): SemanticDiagnosisReport {
  return {
    requested: true,
    consent: 'granted',
    status: 'not_configured',
    provider: null,
    payload: emptyPayload,
    audit: {
      recorded: false,
      retention: 'process_bounded_content_free',
      rawContentStored: false,
    },
    limitations: [
      'Semantic diagnosis was requested, but no LLM_API_KEY is configured; no Provider call was made.',
      'Deterministic diagnosis remains available without an LLM provider.',
    ],
  };
}

function evidenceInsufficientSemanticReport(): SemanticDiagnosisReport {
  return {
    requested: true,
    consent: 'granted',
    status: 'insufficient_evidence',
    provider: null,
    payload: emptyPayload,
    audit: {
      recorded: false,
      retention: 'process_bounded_content_free',
      rawContentStored: false,
    },
    limitations: [
      'No LLM turn in this Session has captured token-usage or model telemetry.',
      'Semantic inference cannot repair missing source evidence; heuristic diagnosis remains available.',
    ],
  };
}

function failedSemanticReport(provider: SemanticDiagnoser['provider']): SemanticDiagnosisReport {
  return {
    requested: true,
    consent: 'granted',
    status: 'failed',
    provider,
    payload: emptyPayload,
    audit: {
      recorded: false,
      retention: 'process_bounded_content_free',
      rawContentStored: false,
    },
    limitations: [
      'The semantic Provider request failed or returned an unusable response.',
      'Deterministic diagnosis remains available without semantic findings.',
    ],
  };
}
