import type { AgentProcessProfile, RelativeCharacteristic } from './profile';

export const PROMPT_REVIEW_SCHEMA_VERSION = 'prompt-review/v1' as const;
export const ITERATION_HINTS_SCHEMA_VERSION = 'iteration-hints/v1' as const;
export const MAX_PROMPT_CHARACTERS = 20_000;
export const MAX_PROMPT_EVIDENCE_CHARACTERS = 140;

export type PromptCheckId =
  | 'goal'
  | 'scope'
  | 'acceptance'
  | 'constraints'
  | 'context'
  | 'verification';
export type PromptCheckStatus = 'present' | 'partial' | 'missing';
export type HintSource = 'prompt_structure' | 'runtime_profile' | 'combined';

export interface PromptStructureCheck {
  id: PromptCheckId;
  label: string;
  status: PromptCheckStatus;
  confidence: 'low' | 'medium' | 'high';
  explanation: string;
  evidence: string[];
  suggestedClause: string;
}

export interface PromptReviewReport {
  schemaVersion: typeof PROMPT_REVIEW_SCHEMA_VERSION;
  generatedAt: number;
  input: {
    characters: number;
    lines: number;
  };
  summary: {
    present: number;
    partial: number;
    missing: number;
  };
  checks: PromptStructureCheck[];
  privacy: {
    retention: 'not_stored';
    semanticProvider: 'not_used';
    evidenceIncluded: boolean;
  };
  limitations: string[];
}

export interface IterationHint {
  id: string;
  priority: 'high' | 'medium' | 'low';
  source: HintSource;
  confidence: 'low' | 'medium' | 'high';
  title: string;
  action: string;
  reason: string;
  evidence: string[];
  guardrail: string;
  requiresOutcomeValidation: true;
}

export interface PromptIterationReport {
  schemaVersion: typeof ITERATION_HINTS_SCHEMA_VERSION;
  generatedAt: number;
  review: PromptReviewReport;
  agentProfile: {
    agent: string;
    comparisonStatus: AgentProcessProfile['comparisonStatus'];
    sessions: number;
  } | null;
  hints: IterationHint[];
  nextStep: string;
}

interface CheckDefinition {
  id: PromptCheckId;
  label: string;
  headings: RegExp[];
  signals: RegExp[];
  explanations: Record<PromptCheckStatus, string>;
  suggestedClause: string;
}

const CHECKS: CheckDefinition[] = [
  {
    id: 'goal',
    label: '目标与交付物',
    headings: [/^\s*(?:#+\s*)?(?:目标|目的|goal|objective|purpose)\s*[:：]?/i],
    signals: [
      /(?:实现|修复|新增|创建|设计|分析|优化|调整|排查|完成|构建|implement|build|fix|create|design|analy[sz]e|improve|refactor)/i,
      /(?:功能|问题|缺陷|bug|页面|接口|API|模块|服务|文档|报告|代码|feature|issue|page|endpoint|module|service|document|report|code)/i,
    ],
    explanations: {
      present: '已观察到明确的动作与交付对象。',
      partial: '观察到目标信号，但动作或交付物仍可能含糊。',
      missing: '未观察到可识别的目标与交付物结构。',
    },
    suggestedClause: '目标：完成【具体交付物】，解决【具体问题】，最终产出【文件、行为或结果】。',
  },
  {
    id: 'scope',
    label: '范围与边界',
    headings: [/^\s*(?:#+\s*)?(?:范围|边界|scope|in scope|out of scope)\s*[:：]?/i],
    signals: [
      /(?:范围|边界|仅|只修改|不涉及|不包括|文件|目录|模块|组件|scope|only|exclude|file|directory|module|component)/i,
      /(?:不要扩展|保持不变|兼容|不改|without changing|keep .* unchanged|backward compatible)/i,
    ],
    explanations: {
      present: '已观察到实现范围和/或排除边界。',
      partial: '提到了范围对象，但边界或非目标仍不够明确。',
      missing: '未观察到明确的实现范围或非目标。',
    },
    suggestedClause: '范围：只修改【模块/文件】；不包含【非目标】；保持【兼容行为】不变。',
  },
  {
    id: 'acceptance',
    label: '验收条件',
    headings: [/^\s*(?:#+\s*)?(?:验收|完成条件|definition of done|acceptance criteria)\s*[:：]?/i],
    signals: [
      /(?:验收|完成条件|必须通过|结果应|预期结果|acceptance|done when|expected result|must pass)/i,
      /(?:返回|显示|生成|不再|成功|通过|状态码|contains|returns|renders|produces|succeeds)/i,
    ],
    explanations: {
      present: '已观察到可判断完成与否的结果描述。',
      partial: '存在结果期望，但还不够可验证或可判定。',
      missing: '未观察到明确的完成/验收条件。',
    },
    suggestedClause: '验收：当【可观察行为】满足【具体条件】，并且【失败场景】得到处理时视为完成。',
  },
  {
    id: 'constraints',
    label: '限制与约束',
    headings: [/^\s*(?:#+\s*)?(?:约束|限制|要求|constraints?|requirements?)\s*[:：]?/i],
    signals: [
      /(?:必须|不得|禁止|不要|限制|上限|本地|隐私|must|must not|do not|never|limit|local|privacy)/i,
      /(?:兼容|安全|性能|不可破坏|不保存|不上传|compatible|secure|performance|do not store|do not upload)/i,
    ],
    explanations: {
      present: '已观察到实现限制、风险或不可违反的约束。',
      partial: '存在约束信号，但优先级或适用范围仍不清晰。',
      missing: '未观察到明确的限制或约束。',
    },
    suggestedClause: '约束：必须遵守【限制】；不得【禁止事项】；优先保证【质量/隐私/兼容护栏】。',
  },
  {
    id: 'context',
    label: '背景与相关上下文',
    headings: [/^\s*(?:#+\s*)?(?:背景|现状|上下文|context|background|current state)\s*[:：]?/i],
    signals: [
      /(?:当前|现状|已经|之前|相关|参考|背景|context|current|existing|previous|related|reference)/i,
      /(?:项目|仓库|代码库|数据|日志|错误|版本|project|repository|codebase|data|log|error|version)/i,
    ],
    explanations: {
      present: '已观察到与任务相关的当前状态或参考上下文。',
      partial: '提供了背景信号，但缺少定位问题所需的具体证据。',
      missing: '未观察到当前状态、相关文件或错误证据。',
    },
    suggestedClause:
      '背景：当前【现状/错误】；相关位置为【文件/模块】；已知证据是【日志/行为/版本】。',
  },
  {
    id: 'verification',
    label: '验证方式',
    headings: [/^\s*(?:#+\s*)?(?:验证|测试|检查|verification|validation|tests?)\s*[:：]?/i],
    signals: [
      /(?:测试|构建|lint|类型检查|验证|回归|test|build|typecheck|type-check|verify|validate|regression)/i,
      /(?:命令|通过|检查|覆盖|手动|自动|command|pass|check|coverage|manual|automatic)/i,
    ],
    explanations: {
      present: '已观察到具体的验证类别或完成检查。',
      partial: '提到了验证，但未说明验证范围或通过标准。',
      missing: '未观察到测试、构建或其他验证要求。',
    },
    suggestedClause: '验证：运行【测试/构建/检查命令】，并确认【关键行为】与【回归范围】。',
  },
];

export function reviewPromptStructure(
  prompt: string,
  options: { includeEvidence?: boolean; generatedAt?: number } = {},
): PromptReviewReport {
  if (prompt.length > MAX_PROMPT_CHARACTERS) {
    throw new RangeError(`prompt exceeds ${MAX_PROMPT_CHARACTERS} characters`);
  }
  const generatedAt = options.generatedAt ?? Date.now();
  const lines = prompt.split(/\r?\n/);
  const checks = CHECKS.map((definition) =>
    reviewCheck(definition, prompt, lines, options.includeEvidence === true),
  );
  const count = (status: PromptCheckStatus) =>
    checks.filter((checkResult) => checkResult.status === status).length;
  return {
    schemaVersion: PROMPT_REVIEW_SCHEMA_VERSION,
    generatedAt,
    input: { characters: prompt.length, lines: lines.length },
    summary: {
      present: count('present'),
      partial: count('partial'),
      missing: count('missing'),
    },
    checks,
    privacy: {
      retention: 'not_stored',
      semanticProvider: 'not_used',
      evidenceIncluded: options.includeEvidence === true,
    },
    limitations: [
      'Checks are deterministic keyword and structure heuristics; they do not establish semantic correctness.',
      'A missing signal can still be present implicitly, and an observed keyword can be incidental.',
      'Prompt quality must ultimately be evaluated against comparable Task Outcomes.',
    ],
  };
}

export function buildPromptIterationReport(
  review: PromptReviewReport,
  profile?: AgentProcessProfile,
  generatedAt = Date.now(),
): PromptIterationReport {
  const hints: IterationHint[] = [];
  const coveredChecks = new Set<PromptCheckId>();
  if (profile?.comparisonStatus === 'ready') {
    addCombinedHints(hints, coveredChecks, review, profile);
  }
  for (const checkResult of review.checks) {
    if (checkResult.status === 'present' || coveredChecks.has(checkResult.id)) continue;
    hints.push(promptGapHint(checkResult));
  }
  if (profile?.comparisonStatus === 'ready') {
    addRuntimeOnlyHints(hints, profile);
  }
  if (hints.length === 0) hints.push(collectOutcomeHint());

  return {
    schemaVersion: ITERATION_HINTS_SCHEMA_VERSION,
    generatedAt,
    review,
    agentProfile: profile
      ? {
          agent: profile.agent,
          comparisonStatus: profile.comparisonStatus,
          sessions: profile.sample.sessions,
        }
      : null,
    hints: hints
      .sort((left, right) => priority(left.priority) - priority(right.priority))
      .slice(0, 6),
    nextStep:
      'Choose one change, run it on a comparable task, and keep it only when Outcome guardrails improve or remain acceptable.',
  };
}

function reviewCheck(
  definition: CheckDefinition,
  prompt: string,
  lines: string[],
  includeEvidence: boolean,
): PromptStructureCheck {
  const hasHeading = lines.some((line) =>
    definition.headings.some((pattern) => pattern.test(line)),
  );
  const signalCount = definition.signals.filter((pattern) => pattern.test(prompt)).length;
  const status: PromptCheckStatus = hasHeading
    ? 'present'
    : signalCount >= 2
      ? 'present'
      : signalCount === 1
        ? 'partial'
        : 'missing';
  const evidence = includeEvidence
    ? lines
        .filter((line) =>
          [...definition.headings, ...definition.signals].some((pattern) => pattern.test(line)),
        )
        .map(redactEvidence)
        .filter(Boolean)
        .slice(0, 2)
    : [];
  return {
    id: definition.id,
    label: definition.label,
    status,
    confidence: hasHeading || signalCount >= 2 ? 'high' : signalCount === 1 ? 'medium' : 'low',
    explanation: definition.explanations[status],
    evidence,
    suggestedClause: definition.suggestedClause,
  };
}

function addCombinedHints(
  hints: IterationHint[],
  coveredChecks: Set<PromptCheckId>,
  review: PromptReviewReport,
  profile: AgentProcessProfile,
): void {
  const relative = new Map(
    profile.relativeCharacteristics.map((characteristic) => [
      characteristic.metric,
      characteristic,
    ]),
  );
  const scope = check(review, 'scope');
  const acceptance = check(review, 'acceptance');
  const context = check(review, 'context');
  const verification = check(review, 'verification');
  const constraints = check(review, 'constraints');

  const tokens = relative.get('resource.tokens_per_session');
  if (tokens?.direction === 'higher' && scope.status !== 'present') {
    coveredChecks.add('scope');
    hints.push(
      combinedHint(
        'bound-scope',
        'high',
        '收紧范围与停止条件',
        scope.suggestedClause,
        '提示词范围信号不足，同时该 Agent 的 Session token 中位高于符合样本要求的同类 Agent。',
        scope,
        tokens,
      ),
    );
  }
  const duration = relative.get('resource.duration_ms_per_session');
  if (duration?.direction === 'higher' && acceptance.status !== 'present') {
    coveredChecks.add('acceptance');
    hints.push(
      combinedHint(
        'define-done',
        'high',
        '明确完成判定，减少开放式迭代',
        acceptance.suggestedClause,
        '验收条件不完整，同时该 Agent 的 Session 时长中位高于符合样本要求的同类 Agent。',
        acceptance,
        duration,
      ),
    );
  }
  const peakContext = relative.get('context.peak_tokens_per_session');
  if (
    peakContext?.direction === 'higher' &&
    (context.status !== 'present' || scope.status !== 'present')
  ) {
    const target = context.status !== 'present' ? context : scope;
    coveredChecks.add(target.id);
    hints.push(
      combinedHint(
        'focus-context',
        'medium',
        '提供必要上下文，同时标明不需要探索的区域',
        target.suggestedClause,
        '上下文或范围结构仍有缺口，同时观察到更高的峰值上下文中位数。',
        target,
        peakContext,
      ),
    );
  }
  const toolErrors = relative.get('reliability.tool_error_rate');
  if (
    toolErrors?.direction === 'higher' &&
    (verification.status !== 'present' || context.status !== 'present')
  ) {
    const target = verification.status !== 'present' ? verification : context;
    coveredChecks.add(target.id);
    hints.push(
      combinedHint(
        'make-verification-explicit',
        'medium',
        '补充环境证据与验证路径',
        target.suggestedClause,
        '提示词缺少验证或环境证据，同时明确观察到的工具错误率高于同类中位。',
        target,
        toolErrors,
      ),
    );
  }
  const sidechain = relative.get('collaboration.sidechain_tool_share');
  if (
    sidechain?.direction === 'higher' &&
    (constraints.status !== 'present' || scope.status !== 'present')
  ) {
    const target = constraints.status !== 'present' ? constraints : scope;
    coveredChecks.add(target.id);
    hints.push(
      combinedHint(
        'bound-delegation',
        'medium',
        '明确委派边界与回收条件',
        '委派约束：子 Agent 只负责【独立子任务】；必须返回【证据/产物】；超过【预算/范围】时停止。',
        '委派边界信号不足，同时该 Agent 的 sidechain 工具占比高于同类中位。',
        target,
        sidechain,
      ),
    );
  }
}

function addRuntimeOnlyHints(hints: IterationHint[], profile: AgentProcessProfile): void {
  const higher = profile.relativeCharacteristics.filter(
    (characteristic) => characteristic.direction === 'higher',
  );
  if (higher.length === 0) return;
  hints.push({
    id: 'validate-runtime-differences',
    priority: 'low',
    source: 'runtime_profile',
    confidence: profile.sample.sessions >= 10 ? 'high' : 'medium',
    title: '用 Outcome 验证运行差异是否值得保留',
    action:
      '选择同类任务记录测试、构建和人工验收，再判断较高的资源或行为指标是必要投入还是可优化开销。',
    reason: '运行画像存在相对差异，但当前未控制任务复杂度，也没有 Outcome。',
    evidence: higher.slice(0, 3).map(relativeEvidence),
    guardrail: '如果质量或可靠性下降，不以降低 token、时长或 sidechain 占比作为成功。',
    requiresOutcomeValidation: true,
  });
}

function promptGapHint(checkResult: PromptStructureCheck): IterationHint {
  return {
    id: `prompt-${checkResult.id}`,
    priority:
      checkResult.id === 'goal' || checkResult.id === 'acceptance'
        ? 'high'
        : checkResult.id === 'verification'
          ? 'medium'
          : 'low',
    source: 'prompt_structure',
    confidence: checkResult.status === 'missing' ? 'medium' : 'low',
    title: `补充${checkResult.label}`,
    action: checkResult.suggestedClause,
    reason: checkResult.explanation,
    evidence: [`prompt check ${checkResult.id}: ${checkResult.status}`],
    guardrail: '这是结构启发式建议；如果当前提示词已隐含表达该信息，可忽略并通过 Outcome 验证。',
    requiresOutcomeValidation: true,
  };
}

function combinedHint(
  id: string,
  hintPriority: IterationHint['priority'],
  title: string,
  action: string,
  reason: string,
  checkResult: PromptStructureCheck,
  characteristic: RelativeCharacteristic,
): IterationHint {
  return {
    id,
    priority: hintPriority,
    source: 'combined',
    confidence:
      characteristic.confidence === 'high' && checkResult.status === 'missing' ? 'high' : 'medium',
    title,
    action,
    reason,
    evidence: [
      `prompt check ${checkResult.id}: ${checkResult.status}`,
      relativeEvidence(characteristic),
    ],
    guardrail:
      '这是结构缺口与运行相关性的组合证据，不是因果证明；一次只改一个变量，并用同类 Task Outcome 验证。',
    requiresOutcomeValidation: true,
  };
}

function collectOutcomeHint(): IterationHint {
  return {
    id: 'collect-outcome',
    priority: 'low',
    source: 'prompt_structure',
    confidence: 'medium',
    title: '结构信号已覆盖，下一步验证结果',
    action: '保持当前结构，记录测试、构建或人工验收 Outcome 后再决定是否改写提示词。',
    reason: '当前启发式检查未发现明显结构缺口，但结构完整不等于任务结果正确。',
    evidence: ['all six structural checks are present'],
    guardrail: '不要仅凭过程成本或一次运行结果认定提示词已优化。',
    requiresOutcomeValidation: true,
  };
}

function relativeEvidence(characteristic: RelativeCharacteristic): string {
  return `${characteristic.metric}: ${characteristic.direction} peer median; ${characteristic.evidence.agentSessions} target sessions, ${characteristic.evidence.peerSessions} peer sessions`;
}

function check(review: PromptReviewReport, id: PromptCheckId): PromptStructureCheck {
  const result = review.checks.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`missing prompt check: ${id}`);
  return result;
}

function redactEvidence(line: string): string {
  const compact = line.trim().replace(/\s+/g, ' ');
  const redacted = compact
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|password|passwd|secret)\s*[:=：]\s*["']?[^,\s"']+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*\b/gi, 'Bearer [REDACTED]');
  if (redacted.length <= MAX_PROMPT_EVIDENCE_CHARACTERS) return redacted;
  return `${redacted.slice(0, MAX_PROMPT_EVIDENCE_CHARACTERS)}…`;
}

function priority(value: IterationHint['priority']): number {
  if (value === 'high') return 0;
  if (value === 'medium') return 1;
  return 2;
}
