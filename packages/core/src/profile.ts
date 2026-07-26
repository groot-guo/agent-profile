export const AGENT_PROFILE_SCHEMA_VERSION = 'agent-profile/v1' as const;
export const MIN_AGENT_PROFILE_SESSIONS = 3;
export const MIN_PROFILE_METRIC_COVERAGE = 0.5;
export const SIMILARITY_THRESHOLD = 0.1;

export type ProfileUnit = 'tokens' | 'CNY' | 'milliseconds' | 'ratio';
export type ProfileComparisonStatus = 'ready' | 'insufficient_data';
export type RelativeDirection = 'higher' | 'lower' | 'similar';

export interface AgentProfileSessionSample {
  id: string;
  agent: string;
  totalTokens: number;
  totalCostCny?: number;
  durationMs?: number;
  cacheHitRate?: number;
  peakContextTokens?: number;
  averageContextTokens?: number;
  llmTurns: number;
  modelKnownTurns: number;
  toolCalls: number;
  toolErrors: number;
  toolEvidenceCalls: number;
  sidechainTurns: number;
  sidechainTools: number;
}

export interface ProfileDistribution {
  unit: ProfileUnit;
  observed: number;
  total: number;
  coverage: number;
  mean: number | null;
  median: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export interface ProfileRate {
  unit: 'ratio';
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface ProfileCoverage {
  knownCost: ProfileRate;
  duration: ProfileRate;
  modelIdentity: ProfileRate;
  toolEvidence: ProfileRate;
  outcome: {
    status: 'not_collected';
    value: 0;
    explanation: string;
  };
}

export interface RelativeCharacteristic {
  metric: string;
  label: string;
  unit: ProfileUnit;
  value: number;
  peerMedian: number;
  deltaRatio: number | null;
  direction: RelativeDirection;
  confidence: 'medium' | 'high';
  evidence: {
    agentSessions: number;
    peerAgents: number;
    peerSessions: number;
    targetCoverage: number;
    peerCoverage: number;
  };
}

export interface AgentProcessProfile {
  agent: string;
  comparisonStatus: ProfileComparisonStatus;
  sample: {
    sessions: number;
    llmTurns: number;
    toolCalls: number;
  };
  dimensions: {
    resourceUsage: {
      tokensPerSession: ProfileDistribution;
      costPerSession: ProfileDistribution;
      durationPerSession: ProfileDistribution;
      cacheHitRate: ProfileDistribution;
    };
    contextDiscipline: {
      peakContextPerSession: ProfileDistribution;
      averageContextPerSession: ProfileDistribution;
    };
    executionReliability: {
      toolErrorRate: ProfileRate;
      sessionsWithToolErrors: ProfileRate;
    };
    collaboration: {
      sidechainTurnShare: ProfileRate;
      sidechainToolShare: ProfileRate;
      sessionsWithSidechains: ProfileRate;
    };
  };
  coverage: ProfileCoverage;
  relativeCharacteristics: RelativeCharacteristic[];
  limitations: string[];
}

export interface AgentProfileReport {
  schemaVersion: typeof AGENT_PROFILE_SCHEMA_VERSION;
  generatedAt: number;
  scope: {
    agents: string[];
    sessions: number;
  };
  comparison: {
    status: ProfileComparisonStatus;
    method: 'agent_metric_vs_peer_agent_median';
    minimumSessionsPerAgent: number;
    minimumMetricCoverage: number;
    similarityThreshold: number;
    interpretation: string;
  };
  profiles: AgentProcessProfile[];
  limitations: string[];
}

interface ComparableMetric {
  metric: string;
  label: string;
  unit: ProfileUnit;
  value: number | null;
  coverage: number;
}

export function buildAgentProfileReport(
  samples: AgentProfileSessionSample[],
  generatedAt = Date.now(),
): AgentProfileReport {
  const grouped = new Map<string, AgentProfileSessionSample[]>();
  for (const sample of samples) {
    const agent = sample.agent || 'unknown';
    const group = grouped.get(agent) ?? [];
    group.push(sample);
    grouped.set(agent, group);
  }

  const profiles = [...grouped.entries()]
    .map(([agent, agentSamples]) => buildProcessProfile(agent, agentSamples))
    .sort((left, right) => {
      if (right.sample.sessions !== left.sample.sessions) {
        return right.sample.sessions - left.sample.sessions;
      }
      return left.agent.localeCompare(right.agent);
    });

  for (const profile of profiles) {
    const eligiblePeers = profiles.filter(
      (peer) => peer.agent !== profile.agent && peer.sample.sessions >= MIN_AGENT_PROFILE_SESSIONS,
    );
    if (profile.sample.sessions < MIN_AGENT_PROFILE_SESSIONS || eligiblePeers.length === 0) {
      profile.comparisonStatus = 'insufficient_data';
      continue;
    }
    profile.comparisonStatus = 'ready';
    profile.relativeCharacteristics = buildCharacteristics(profile, eligiblePeers);
  }

  const readyProfiles = profiles.filter((profile) => profile.comparisonStatus === 'ready');
  return {
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
    generatedAt,
    scope: {
      agents: profiles.map((profile) => profile.agent),
      sessions: samples.length,
    },
    comparison: {
      status: readyProfiles.length > 0 ? 'ready' : 'insufficient_data',
      method: 'agent_metric_vs_peer_agent_median',
      minimumSessionsPerAgent: MIN_AGENT_PROFILE_SESSIONS,
      minimumMetricCoverage: MIN_PROFILE_METRIC_COVERAGE,
      similarityThreshold: SIMILARITY_THRESHOLD,
      interpretation:
        'Higher/lower describes observed process behavior relative to the median eligible peer Agent; it does not mean better/worse.',
    },
    profiles,
    limitations: [
      'Task type and complexity are not controlled, so differences are observational rather than causal.',
      'Outcome quality is not collected; this report cannot determine whether the requested deliverable was correct.',
      'Missing source fields reduce metric coverage and must not be interpreted as zero, success, or failure.',
      'Tool-error availability is not separately represented by every source; error rates count explicit observed errors only.',
    ],
  };
}

function buildProcessProfile(
  agent: string,
  samples: AgentProfileSessionSample[],
): AgentProcessProfile {
  const sessions = samples.length;
  const llmTurns = sum(samples.map((sample) => sample.llmTurns));
  const toolCalls = sum(samples.map((sample) => sample.toolCalls));
  const toolErrors = sum(samples.map((sample) => sample.toolErrors));
  const sidechainTurns = sum(samples.map((sample) => sample.sidechainTurns));
  const sidechainTools = sum(samples.map((sample) => sample.sidechainTools));
  const sessionsWithToolErrors = samples.filter((sample) => sample.toolErrors > 0).length;
  const sessionsWithSidechains = samples.filter(
    (sample) => sample.sidechainTurns > 0 || sample.sidechainTools > 0,
  ).length;
  const knownCosts = samples.filter((sample) => sample.totalCostCny !== undefined).length;
  const knownDurations = samples.filter((sample) => sample.durationMs !== undefined).length;
  const modelKnownTurns = sum(samples.map((sample) => sample.modelKnownTurns));
  const toolEvidenceCalls = sum(samples.map((sample) => sample.toolEvidenceCalls));
  const limitations: string[] = [];

  if (sessions < MIN_AGENT_PROFILE_SESSIONS) {
    limitations.push(
      `Only ${sessions} session(s) are available; at least ${MIN_AGENT_PROFILE_SESSIONS} are required for relative characteristics.`,
    );
  }
  if (knownCosts < sessions) {
    limitations.push('Some sessions contain unknown model pricing, so cost coverage is partial.');
  }
  if (knownDurations < sessions) {
    limitations.push('Some sessions have no end time, so duration coverage is partial.');
  }

  return {
    agent,
    comparisonStatus: 'insufficient_data',
    sample: { sessions, llmTurns, toolCalls },
    dimensions: {
      resourceUsage: {
        tokensPerSession: distribution(
          samples.map((sample) => sample.totalTokens),
          sessions,
          'tokens',
        ),
        costPerSession: distribution(
          samples.map((sample) => sample.totalCostCny),
          sessions,
          'CNY',
        ),
        durationPerSession: distribution(
          samples.map((sample) => sample.durationMs),
          sessions,
          'milliseconds',
        ),
        cacheHitRate: distribution(
          samples.map((sample) => sample.cacheHitRate),
          sessions,
          'ratio',
        ),
      },
      contextDiscipline: {
        peakContextPerSession: distribution(
          samples.map((sample) => sample.peakContextTokens),
          sessions,
          'tokens',
        ),
        averageContextPerSession: distribution(
          samples.map((sample) => sample.averageContextTokens),
          sessions,
          'tokens',
        ),
      },
      executionReliability: {
        toolErrorRate: rate(toolErrors, toolCalls),
        sessionsWithToolErrors: rate(sessionsWithToolErrors, sessions),
      },
      collaboration: {
        sidechainTurnShare: rate(sidechainTurns, llmTurns),
        sidechainToolShare: rate(sidechainTools, toolCalls),
        sessionsWithSidechains: rate(sessionsWithSidechains, sessions),
      },
    },
    coverage: {
      knownCost: rate(knownCosts, sessions),
      duration: rate(knownDurations, sessions),
      modelIdentity: rate(modelKnownTurns, llmTurns),
      toolEvidence: rate(toolEvidenceCalls, toolCalls),
      outcome: {
        status: 'not_collected',
        value: 0,
        explanation:
          'Task/Outcome capture is not implemented, so tests, build results, and human acceptance are outside this profile.',
      },
    },
    relativeCharacteristics: [],
    limitations,
  };
}

function buildCharacteristics(
  profile: AgentProcessProfile,
  peers: AgentProcessProfile[],
): RelativeCharacteristic[] {
  const targetMetrics = comparableMetrics(profile);
  const peerMetrics = new Map(peers.map((peer) => [peer.agent, comparableMetrics(peer)]));
  const characteristics: RelativeCharacteristic[] = [];

  for (const target of targetMetrics) {
    if (target.value === null || target.coverage < MIN_PROFILE_METRIC_COVERAGE) {
      continue;
    }
    const eligible = peers.flatMap((peer) => {
      const metric = peerMetrics
        .get(peer.agent)
        ?.find((candidate) => candidate.metric === target.metric);
      if (!metric || metric.value === null || metric.coverage < MIN_PROFILE_METRIC_COVERAGE) {
        return [];
      }
      return [{ profile: peer, metric }];
    });
    if (eligible.length === 0) continue;

    const peerMedian = quantile(
      eligible.map(({ metric }) => metric.value as number),
      0.5,
    );
    const deltaRatio =
      peerMedian === 0
        ? target.value === 0
          ? 0
          : null
        : (target.value - peerMedian) / Math.abs(peerMedian);
    const direction =
      deltaRatio === null
        ? target.value > peerMedian
          ? 'higher'
          : 'lower'
        : Math.abs(deltaRatio) <= SIMILARITY_THRESHOLD
          ? 'similar'
          : deltaRatio > 0
            ? 'higher'
            : 'lower';

    characteristics.push({
      metric: target.metric,
      label: target.label,
      unit: target.unit,
      value: target.value,
      peerMedian,
      deltaRatio,
      direction,
      confidence: profile.sample.sessions >= 10 ? 'high' : 'medium',
      evidence: {
        agentSessions: profile.sample.sessions,
        peerAgents: eligible.length,
        peerSessions: sum(eligible.map(({ profile: peer }) => peer.sample.sessions)),
        targetCoverage: target.coverage,
        peerCoverage: sum(eligible.map(({ metric }) => metric.coverage)) / eligible.length,
      },
    });
  }
  return characteristics;
}

function comparableMetrics(profile: AgentProcessProfile): ComparableMetric[] {
  const resource = profile.dimensions.resourceUsage;
  const context = profile.dimensions.contextDiscipline;
  const reliability = profile.dimensions.executionReliability;
  const collaboration = profile.dimensions.collaboration;
  return [
    {
      metric: 'resource.tokens_per_session',
      label: 'Median tokens per session',
      unit: 'tokens',
      value: resource.tokensPerSession.median,
      coverage: resource.tokensPerSession.coverage,
    },
    {
      metric: 'resource.cost_cny_per_session',
      label: 'Median cost per session',
      unit: 'CNY',
      value: resource.costPerSession.median,
      coverage: resource.costPerSession.coverage,
    },
    {
      metric: 'resource.duration_ms_per_session',
      label: 'Median duration per session',
      unit: 'milliseconds',
      value: resource.durationPerSession.median,
      coverage: resource.durationPerSession.coverage,
    },
    {
      metric: 'resource.cache_hit_rate',
      label: 'Median cache-hit rate',
      unit: 'ratio',
      value: resource.cacheHitRate.median,
      coverage: resource.cacheHitRate.coverage,
    },
    {
      metric: 'context.peak_tokens_per_session',
      label: 'Median peak context',
      unit: 'tokens',
      value: context.peakContextPerSession.median,
      coverage: context.peakContextPerSession.coverage,
    },
    {
      metric: 'reliability.tool_error_rate',
      label: 'Tool error rate',
      unit: 'ratio',
      value: reliability.toolErrorRate.value,
      coverage: reliability.toolErrorRate.denominator > 0 ? 1 : 0,
    },
    {
      metric: 'collaboration.sidechain_tool_share',
      label: 'Sidechain tool share',
      unit: 'ratio',
      value: collaboration.sidechainToolShare.value,
      coverage: collaboration.sidechainToolShare.denominator > 0 ? 1 : 0,
    },
  ];
}

function distribution(
  values: Array<number | undefined>,
  total: number,
  unit: ProfileUnit,
): ProfileDistribution {
  const observed = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  if (observed.length === 0) {
    return {
      unit,
      observed: 0,
      total,
      coverage: total > 0 ? 0 : 1,
      mean: null,
      median: null,
      p90: null,
      min: null,
      max: null,
    };
  }
  const sorted = [...observed].sort((left, right) => left - right);
  return {
    unit,
    observed: sorted.length,
    total,
    coverage: total > 0 ? sorted.length / total : 1,
    mean: sum(sorted) / sorted.length,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function rate(numerator: number, denominator: number): ProfileRate {
  return {
    unit: 'ratio',
    value: denominator > 0 ? numerator / denominator : null,
    numerator,
    denominator,
  };
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[index];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
