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

The server sends at most five truncated thinking snippets and twenty summarized
tool calls in one request. It asks for a strict JSON array, applies a 30-second
timeout, and returns only heuristic findings if the provider fails or the
response cannot be parsed.

### Configuration

- `LLM_API_KEY` — enables semantic diagnosis.
- `LLM_PROVIDER` — `anthropic` or `openai`; otherwise inferred from the base
  URL.
- `LLM_BASE_URL` — provider API base URL.
- `LLM_MODEL` — provider model identifier.

No semantic call is made when `LLM_API_KEY` is absent.

## Trust and privacy boundaries

- Semantic findings are model inference and are labelled separately from
  deterministic findings; each should retain evidence span IDs.
- Thinking/tool fragments may be sent to the configured external provider.
  Users should use an approved/local endpoint when source data is sensitive.
- Inputs are truncated and summarized, so a semantic finding can have
  incomplete context.
- The current implementation does not persist a separate semantic-analysis
  token/cost ledger or cache results by session-content hash. Those remain
  explicit follow-up opportunities, not current capabilities.
- Neither layer knows whether the final task outcome was correct unless a
  separate verifiable outcome exists.

## Request flow

```text
GET /api/session/:id/diagnosis
  → load normalized session and spans
  → run 7 heuristic rules
  → when LLM is configured:
       summarize bounded evidence
       → provider request with 30-second timeout
       → parse semantic findings
       → merge with deterministic findings
  → on any semantic failure, return heuristic findings
```

Any future change to rules, thresholds, semantic prompts, providers, evidence
coverage, or displayed confidence must start with a task in `roadmap.md` and
must update this document after implementation.
