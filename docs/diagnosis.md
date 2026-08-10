# Diagnosis Design and Current Behavior

Diagnosis has two current layers:

1. deterministic heuristic rules that quantify observable patterns;
2. optional LLM semantic analysis that interprets thinking/tool sequences.

The heuristic layer always works locally. The semantic layer requires both an
LLM API key and request-scoped `semantic=opt_in`; it degrades to heuristic-only
results on provider, timeout, or parsing failure.

## Heuristic rules

Each rule outputs a `DiagnosisFinding` with type, severity, title, detail,
estimated waste, cost-coverage information, suggestion, and evidence span IDs.
Findings are sorted by severity and estimated wasted tokens.

| Type | Detection | Wasted-token estimate |
| --- | --- | --- |
| `repeated_read` | same file path read at least twice | later reads' output bytes / 4 |
| `large_output` | tool output over 10 KB carried through later turns | output bytes / 4 × later turns |
| `low_cache` | cache hit below threshold with sufficient input | uncached input + cache creation |
| `context_bloat` | high window utilization or peak context | estimated compressible history |
| `long_thinking` | thinking text over threshold | characters / 4 × estimate factor |
| `repeated_failure` | same tool fails consecutively | related parent-turn output tokens |
| `read_scope_too_large` | unbounded Read with large output | output bytes / 4 × estimate factor |
| `same_param_loop` | same tool with identical input repeats in one consecutive run (four calls at the current default threshold) | 70% of the repeated calls' output bytes / 4 |
| `write_then_read` | the same file is read shortly after a Write or Edit | 50% of the later Read output bytes / 4 |
| `context_compression` | adjacent LLM turns show a context drop of at least 50% | 30% of the dropped context tokens as possible reread work |
| `model_downgrade` | a later turn changes to a model whose input price is less than half of the prior model's | no waste estimate; an observed behavior signal |

Thresholds and exact formulas live in
`packages/core/src/diagnosis.ts`. Waste and cost values are heuristic estimates,
not invoices or proof that the work was unnecessary. Unknown model pricing is
reported as unknown rather than converted into a trusted cost.

## Optional semantic diagnosis

`packages/core` defines the provider-independent `LlmDiagnoser` interface.
`apps/server/src/llm-diagnoser.ts` implements Anthropic-native and
OpenAI-compatible HTTP clients. `apps/server/src/routes/diagnosis.ts` invokes
that implementation only for an explicit request-scoped opt-in; the normal
Session analysis path remains deterministic and local.

The current semantic types are:

- `thinking_detour` — reasoning appears off-task, looping, or irrelevant;
- `ineffective_exploration` — repeated exploration without visible progress;
- `tool_off_target` — tool activity appears unrelated to the task.

When the semantic path is enabled, the server sends a bounded, redacted payload:
the captured Session title (at most 500 characters), at most five thinking
snippets (500 characters each), and at most twenty tool calls (200-character
tool names and inputs). It asks for a strict JSON array, applies a 30-second
timeout, validates returned findings against the current evidence span IDs, and
returns only heuristic findings if the provider fails or the response cannot be
parsed. The response includes a `semantic` report with consent, status, Provider,
payload counts, redaction count, and limitations; it never includes the payload.

### Configuration

- `LLM_API_KEY` — enables semantic diagnosis.
- `LLM_PROVIDER` — `anthropic` or `openai`; otherwise inferred from the base
  URL.
- `LLM_BASE_URL` — provider API base URL.
- `LLM_MODEL` — provider model identifier.

No semantic call is made when `LLM_API_KEY` is absent. Without overrides, the
OpenAI-compatible path defaults to the external DeepSeek endpoint and
`deepseek-chat`; a custom `LLM_BASE_URL` may be local or external, and the
application does not verify that distinction.

## Trust and privacy boundaries

- Semantic findings are model inference and are labelled separately from
  deterministic findings; returned span IDs are constrained to the current
  Session evidence.
- This semantic path is not local-only. It requires both `LLM_API_KEY` and an
  explicit `GET /api/session/:id/diagnosis?semantic=opt_in` request. The shared
  redaction pass covers common credential forms before payload construction, but
  is not a guarantee against every secret. A bounded process-local audit retains
  only Session ID, timestamps, status, Provider, and payload counts; raw source
  and Provider response content are not stored.
- Truncation and redaction reduce disclosure risk but do not prove a payload is
  safe for every endpoint. A semantic finding can have incomplete context and
  cannot establish the final Task Outcome.
- The current implementation does not persist a separate semantic-analysis
  token/cost ledger or cache results by session-content hash. Those remain
  explicit follow-up opportunities, not current capabilities.
- Neither layer knows whether the final task outcome was correct unless a
  separate verifiable outcome exists.

## Request flow

```text
GET /api/session/:id/diagnosis[?semantic=opt_in]
  → load normalized session and spans
  → run 11 deterministic heuristic rules
  → when semantic=opt_in, LLM is configured, and evidence exists:
       construct bounded, redacted provider payload
       → provider request with 30-second timeout
       → parse semantic findings
       → merge with deterministic findings
       → return content-free semantic metadata and record bounded audit metadata
  → without opt-in, or on any semantic failure, return heuristic findings
```

T111 implements request-level consent, tested redaction, and content-free audit
metadata. Findings with stored Span references now expose a bounded navigation
to `view=evidence&spanIds=<comma-separated-ids>` in Session detail. The evidence
route validates and caps the exact target list, keeps `content=none` by default,
and reports a target as unavailable when it was rebuilt, is missing, or is
excluded by an active filter. Findings without Span IDs do not link to inferred
nearby events. This preserves the content-free default while making the stored
evidence reference inspectable.

Diagnosis consumes normalized evidence through the source-coverage contract
introduced by T134: every LLM Span carries a source-faithful
`tokenUsageSource` origin (`message_usage`, `token_count`,
`total_tokens_fallback`, `session_aggregate`, `request_token_usage`, or
`not_captured`), and the evidence report exposes per-turn token-usage
coverage plus Session-level `tokenUsage` coverage. A turn with
`tokenUsageSource=not_captured` or `stubTurn=true` has no measured token or
cost evidence; heuristic findings that depend on token volume must not treat
that absence as a zero-usage turn.

Semantic Provider configuration is server-only (T138). `GET /api/provider/status`
returns non-secret status (provider, model, endpoint host, loopback/external
locality, configuration source, test status, restart requirements) and
`PUT /api/provider/configuration` stores the key in a `0600` `provider.json`
file in the application data directory; the key never reaches browser state,
localStorage, SQLite, logs, exports, or source files. Environment variables
remain a legacy fallback. Every LLM-assisted entry point reports
`not_configured`, `insufficient_evidence`, `completed`, or `failed` before any
payload is sent, and semantic conclusions are suppressed when the structural
token/model telemetry required for the claim is not captured.

Session-detail presentation (T140) follows the same evidence boundary: cost,
context, and cache panels render `not_captured` as unavailable rather than
`¥0` or a zero percent, and a partial known subtotal is labeled partial.
Diagnosis findings that depend on missing token volume are not presented as
proof of zero usage.
Any future change to rules, thresholds, semantic prompts, providers, evidence
coverage, or displayed confidence must start with a task in `roadmap.md` and
must update this document after implementation.
