# Diagnosis Design

Two layers: heuristic rules (quantified, free) + LLM semantic analysis (qualitative, optional).

## Heuristic Rules (P1 + P2.18, implemented)

Each rule outputs `DiagnosisFinding { type, severity, title, detail, wastedTokens, wastedCost, costUnknown, suggestion, spanIds }`. Findings sorted by severity (high > medium > low), then wastedTokens desc.

| type | detection | wastedTokens estimate |
|---|---|---|
| repeated_read | same file_path Read ≥ 2 | sum of later reads' outputBytes / 4 |
| large_output | tool outputBytes > 10KB × subsequent turns | outputBytes/4 × afterTurns (theoretical upper bound) |
| low_cache | cacheHitRate < 0.5 (totalInput > 10k) | input + cache_creation (uncached portion) |
| context_bloat | window utilization > 70% or peak > 100k | peak × 0.4 (compressible history estimate) |
| long_thinking | thinking chars > 4000 (top 5 + aggregate rest) | chars/4 × 0.5 |
| repeated_failure | same tool consecutive isError ≥ 2 | sum of parent turn outputTokens |
| read_scope_too_large | Read no limit + output > 20KB | outputBytes/4 × 0.5 |

- token estimate: bytes / 4
- wastedCost: wastedTokens × model input_price (upper bound; cache is cheaper). Unknown model → costUnknown, cost=0.
- thresholds configurable via `DiagnosisThresholds` / `DEFAULT_THRESHOLDS` (`packages/core/src/diagnosis.ts`).

## LLM Semantic Analysis (P2.19, interface reserved, not implemented)

### Scope

LLM does qualitative judgment only:
- thinking_detour: reasoning off-task, loops, irrelevant
- ineffective_exploration: repeated trial-and-error patterns
- tool_off_target: tool calls not serving task goal

LLM does NOT do: quantified diagnosis (rules are accurate and free); detection of repeated_read / repeated_failure (rules detect, LLM only explains root cause).

### Interface (reserved in core)

```
LlmDiagnoseContext  →  LlmDiagnoser.diagnose(ctx): Promise<LlmFinding[]>
  - taskTitle             - type: thinking_detour | ineffective_exploration | tool_off_target
  - thinkingTexts[]       - severity / title / detail / suggestion / spanIds
  - toolCallSequence[]
```

core defines interface only (no fetch/http dependency). Implementation (LLM API call) lives in server, injected into `diagnoseSession` via routes. `diagnoseSession` is async; runs LLM only if `llmDiagnoser` injected.

### Call Strategy (cost/latency control)

1. Heuristic pre-filter: only send rule-flagged suspects to LLM (long_thinking top5, repeated_failure related thinking, repeated_read related turns). LLM does not detect, only qualifies.
2. Batch single prompt: analyze batch (5 thinking + related tool sequence) per request, not per-item.
3. Truncate input: thinking already truncated to 10KB by parser; LLM input further limited to 2KB per item.
4. Tiered switch: `DIAG_LLM=off | high-only | all`, default off.

### Model

Analyzed session uses GLM-5.2 / DeepSeek-v4; analysis model can differ (analyzed=glm, analysis=deepseek-pro). Prefer reasoning model (DeepSeek-v4-pro / GLM thinking mode). Connect via OpenAI-compatible API (Zhipu / DeepSeek), key via env (`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`).

### Sync / Async

| option | approach | tradeoff |
|---|---|---|
| A sync + timeout | LLM with 30s timeout, degrade to heuristic on timeout | simple; request may be slow |
| B async | diagnosis returns heuristic immediately, LLM background, frontend poll/SSE | better UX; complex |

Recommend A first (timeout degrade preserves availability).

### Data Flow

```
GET /api/session/:id/diagnosis
  → heuristic diagnosis (sync, 7 rules)
  → if llmDiagnoser injected and enabled:
      pre-filter suspects → build batch prompt → call LLM (30s timeout)
      → parse JSON findings → merge (severity sort, LLM findings tagged "semantic")
  → return (timeout → heuristic only)
```

### Prompt

- system: Agent runtime analyst, judge thinking/tool deviation, output strict JSON.
- user: task title + N thinking fragments + tool sequence summary + judgment requirement.
- output: strict JSON schema (`LlmFinding[]`); parse failure → skip, do not block.
- few-shot: 1-2 examples anchoring deviation/normal.

### Trustworthiness & Display

- LLM may false-positive: each LlmFinding tagged "semantic (reference)", visually distinct from rule findings in UI.
- Optional user feedback (👍/👎) to refine prompt.

### Analysis Cost

- LLM analysis consumes tokens itself; **record separately** (analysis model input/output + cost), displayed in diagnosis area ("analysis cost X tokens / ¥Y"), **not mixed** into analyzed session's cost.

### Risks

- subjectivity: LLM judgment non-authoritative, tag "reference"
- cost inversion: small session's analysis cost may exceed its own cost → default off
- truncation: thinking truncated to 10KB by parser, LLM sees only first 10KB
- privacy: transcript sent to external LLM API → support local model (`LLM_BASE_URL`) or explicit consent

### Gradual Path

- P2.19a: analyze long_thinking top5 (minimal closed loop) — validate prompt + call chain + cost recording
- P2.19b: tool sequence deviation
- P2.19c: content precision (Read scope advice, output truncation advice)
- P2.19d: async + result cache (by session content hash)
