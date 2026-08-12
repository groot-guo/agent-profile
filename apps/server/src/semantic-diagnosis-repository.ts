import type { DiagnosisFinding, SemanticDiagnosisReport } from '@agent-profile/core';
import type { DatabaseConnection } from './database';

const MAX_FINDINGS = 20;
const MAX_LIMITATIONS = 20;
const MAX_LIMITATION_CHARACTERS = 500;
const STORED_FINDING_TYPES = new Set([
  'thinking_detour',
  'ineffective_exploration',
  'tool_off_target',
]);
const STORED_SEVERITIES = new Set(['high', 'medium', 'low']);
const STORED_SEMANTIC_STATUSES = new Set([
  'not_requested',
  'not_configured',
  'insufficient_evidence',
  'completed',
  'failed',
]);
const STORED_PROVIDERS = new Set(['anthropic', 'openai']);

export interface StoredSemanticDiagnosis {
  sessionId: string;
  sourceFingerprint: string | null;
  savedAt: number;
  semantic: SemanticDiagnosisReport;
  findings: DiagnosisFinding[];
}

interface SemanticDiagnosisRow {
  sessionId: string;
  sourceFingerprint: string | null;
  updatedAt: number;
  semanticJson: string;
  findingsJson: string;
}

function boundedFinding(finding: DiagnosisFinding): DiagnosisFinding {
  return {
    type: finding.type,
    severity: finding.severity,
    title: finding.title.slice(0, 300),
    detail: finding.detail.slice(0, 1_000),
    wastedTokens: Number.isFinite(finding.wastedTokens) ? finding.wastedTokens : 0,
    wastedCost: Number.isFinite(finding.wastedCost) ? finding.wastedCost : 0,
    costUnknown: finding.costUnknown,
    suggestion: finding.suggestion.slice(0, 500),
    spanIds: finding.spanIds.slice(0, 20),
  };
}

function boundedSemantic(
  semantic: SemanticDiagnosisReport,
  findingCount: number,
  savedAt: number,
): SemanticDiagnosisReport {
  return {
    requested: semantic.requested,
    consent: semantic.consent,
    status: semantic.status,
    provider: semantic.provider,
    findingCount,
    savedAt,
    payload: { ...semantic.payload },
    audit: { ...semantic.audit },
    limitations: semantic.limitations
      .slice(0, MAX_LIMITATIONS)
      .map((limitation) => limitation.slice(0, MAX_LIMITATION_CHARACTERS)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredFinding(value: unknown): value is DiagnosisFinding {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    STORED_FINDING_TYPES.has(value.type) &&
    typeof value.severity === 'string' &&
    STORED_SEVERITIES.has(value.severity) &&
    typeof value.title === 'string' &&
    value.title.startsWith('[LLM]') &&
    value.title.length <= 300 &&
    typeof value.detail === 'string' &&
    value.detail.length <= 1_000 &&
    typeof value.suggestion === 'string' &&
    value.suggestion.length <= 500 &&
    typeof value.wastedTokens === 'number' &&
    Number.isFinite(value.wastedTokens) &&
    typeof value.wastedCost === 'number' &&
    Number.isFinite(value.wastedCost) &&
    typeof value.costUnknown === 'boolean' &&
    Array.isArray(value.spanIds) &&
    value.spanIds.length <= 20 &&
    value.spanIds.every((spanId) => typeof spanId === 'string')
  );
}

function isStoredSemantic(value: unknown): value is SemanticDiagnosisReport {
  if (!isRecord(value) || !isRecord(value.payload) || !isRecord(value.audit)) return false;
  return (
    typeof value.requested === 'boolean' &&
    (value.consent === 'not_granted' || value.consent === 'granted') &&
    typeof value.status === 'string' &&
    STORED_SEMANTIC_STATUSES.has(value.status) &&
    (value.provider === null ||
      (typeof value.provider === 'string' && STORED_PROVIDERS.has(value.provider))) &&
    typeof value.findingCount === 'number' &&
    Number.isInteger(value.findingCount) &&
    value.findingCount >= 0 &&
    value.findingCount <= MAX_FINDINGS &&
    typeof value.savedAt === 'number' &&
    Number.isFinite(value.savedAt) &&
    (value.payload.mode === 'not_sent' || value.payload.mode === 'bounded_redacted') &&
    typeof value.payload.thinkingItems === 'number' &&
    Number.isInteger(value.payload.thinkingItems) &&
    value.payload.thinkingItems >= 0 &&
    value.payload.thinkingItems <= 5 &&
    typeof value.payload.toolItems === 'number' &&
    Number.isInteger(value.payload.toolItems) &&
    value.payload.toolItems >= 0 &&
    value.payload.toolItems <= 20 &&
    typeof value.payload.characters === 'number' &&
    Number.isInteger(value.payload.characters) &&
    value.payload.characters >= 0 &&
    value.payload.characters <= 11_000 &&
    typeof value.payload.redactions === 'number' &&
    Number.isInteger(value.payload.redactions) &&
    value.payload.redactions >= 0 &&
    value.payload.rawContentIncluded === false &&
    typeof value.audit.recorded === 'boolean' &&
    value.audit.retention === 'process_bounded_content_free' &&
    value.audit.rawContentStored === false &&
    Array.isArray(value.limitations) &&
    value.limitations.length <= MAX_LIMITATIONS &&
    value.limitations.every(
      (limitation) =>
        typeof limitation === 'string' && limitation.length <= MAX_LIMITATION_CHARACTERS,
    )
  );
}

export class SemanticDiagnosisRepository {
  constructor(private readonly database: DatabaseConnection) {}

  save(
    sessionId: string,
    sourceFingerprint: string | undefined,
    semantic: SemanticDiagnosisReport,
    findings: DiagnosisFinding[],
    savedAt: number,
  ): void {
    const storedFindings = findings
      .filter((finding) => finding.title.startsWith('[LLM]'))
      .slice(0, MAX_FINDINGS)
      .map(boundedFinding);
    const storedSemantic = boundedSemantic(semantic, storedFindings.length, savedAt);
    this.database
      .prepare(
        `INSERT INTO semantic_diagnoses (
          session_id, source_fingerprint, requested_at, status, provider,
          semantic_json, findings_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          source_fingerprint = excluded.source_fingerprint,
          requested_at = excluded.requested_at,
          status = excluded.status,
          provider = excluded.provider,
          semantic_json = excluded.semantic_json,
          findings_json = excluded.findings_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        sourceFingerprint ?? null,
        savedAt,
        storedSemantic.status,
        storedSemantic.provider,
        JSON.stringify(storedSemantic),
        JSON.stringify(storedFindings),
        savedAt,
      );
  }

  load(sessionId: string, sourceFingerprint: string | undefined): StoredSemanticDiagnosis | null {
    const row = this.database
      .prepare(
        `SELECT session_id as sessionId, source_fingerprint as sourceFingerprint,
                updated_at as updatedAt, semantic_json as semanticJson,
                findings_json as findingsJson
         FROM semantic_diagnoses WHERE session_id = ?`,
      )
      .get(sessionId) as SemanticDiagnosisRow | undefined;
    if (!row || row.sourceFingerprint !== (sourceFingerprint ?? null)) return null;
    try {
      const semantic = JSON.parse(row.semanticJson) as SemanticDiagnosisReport;
      const parsedFindings = JSON.parse(row.findingsJson) as unknown;
      if (!Array.isArray(parsedFindings) || !parsedFindings.every(isStoredFinding)) return null;
      if (
        !isStoredSemantic(semantic) ||
        semantic.findingCount !== parsedFindings.length ||
        semantic.savedAt !== row.updatedAt
      )
        return null;
      return {
        sessionId: row.sessionId,
        sourceFingerprint: row.sourceFingerprint,
        savedAt: row.updatedAt,
        semantic,
        findings: parsedFindings,
      };
    } catch {
      return null;
    }
  }
}
