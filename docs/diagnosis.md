# Diagnosis Design and Current Behavior

Diagnosis has two current layers:

1. deterministic heuristic rules that quantify observable patterns;
2. optional LLM semantic analysis that interprets thinking/tool sequences.

The heuristic layer always works locally. The semantic layer is enabled only
when an LLM API key is configured and degrades to heuristic-only results on
provider, timeout, or parsing failure.

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
OpenAI-compatible HTTP clients. `apps/server/src/routes/diagnosis.ts` injects
that implementation into the async diagnosis path when credentials exist.

The current semantic types are:

- `thinking_detour` — reasoning appears off-task, looping, or irrelevant;
- `ineffective_exploration` — repeated exploration without visible progress;
- `tool_off_target` — tool activity appears unrelated to the task.

When the semantic path is enabled, the server sends the captured Session title
when present, at most five thinking snippets (the first 2,000 characters of
each), and at most twenty tool calls (name, error state, and the first 200
characters of each stored input). It asks for a strict JSON array, applies a
30-second timeout, and returns only heuristic findings if the provider fails or
the response cannot be parsed.

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
  deterministic findings; each should retain evidence span IDs.
- This semantic path is not local-only. With `LLM_API_KEY` configured, a
  request to `GET /api/session/:id/diagnosis` invokes the provider path when
  evidence exists. The current implementation has no request-scoped consent,
  pre-transmission secret-redaction pass, or content-free provider-call audit.
  The bounded title/thinking/tool-input payload described above can therefore
  contain sensitive source-derived content. Use only an approved endpoint, or
  leave `LLM_API_KEY` unset to keep diagnosis deterministic and local.
- Truncation limits payload size; they are not redaction. A semantic finding can
  have incomplete context and cannot establish the final Task Outcome.
- The current implementation does not persist a separate semantic-analysis
  token/cost ledger or cache results by session-content hash. Those remain
  explicit follow-up opportunities, not current capabilities.
- Neither layer knows whether the final task outcome was correct unless a
  separate verifiable outcome exists.

## Request flow

```text
GET /api/session/:id/diagnosis
  → load normalized session and spans
  → run 11 deterministic heuristic rules
  → when LLM is configured and at least one captured thinking/tool-call Span exists:
       construct the bounded provider payload
       (no request-level opt-in or pre-send redaction in the current release)
       → provider request with 30-second timeout
       → parse semantic findings
       → merge with deterministic findings
  → on any semantic failure, return heuristic findings
```

T111 owns request-level consent, tested redaction, and content-free audit
metadata before any semantic-provider hardening can be claimed. T112 owns
finding-to-evidence navigation; it must preserve bounded, content-free defaults.
Any future change to rules, thresholds, semantic prompts, providers, evidence
coverage, or displayed confidence must start with a task in `roadmap.md` and
must update this document after implementation.
