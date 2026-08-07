import type {
  CliDiagnosisReport,
  CliEvidenceReport,
  CliProfilesReport,
  CliReport,
  CliServeReport,
  CliSessionsReport,
  CliSourcesReport,
  CliStatsReport,
  CliSyncReport,
  CliTaskFeedbackReport,
  CliTaskOutcomeReport,
  CliTaskProfileReport,
} from '@agent-profile/contracts';

export function formatReport(report: CliReport): string {
  if (report.command === 'help') return `${report.usage}\n`;
  if (report.command === 'version') return `${report.version}\n`;
  if (report.command === 'sources' || report.command === 'sync') return formatSourcesReport(report);
  if (report.command === 'serve') return formatServeReport(report);
  if (report.command === 'sessions') return formatSessionsReport(report);
  if (report.command === 'stats') return formatStatsReport(report);
  if (report.command === 'profiles') return formatProfilesReport(report);
  if (report.command === 'task-profile') return formatTaskProfileReport(report);
  if (report.command === 'diagnosis') return formatDiagnosisReport(report);
  if (report.command === 'evidence') return formatEvidenceReport(report);
  if (report.command === 'task-outcome') return formatTaskOutcomeReport(report);
  if (report.command === 'task-feedback') return formatTaskFeedbackReport(report);

  const sourceLines = report.sources.map((source) => {
    const availability = source.available ? 'available' : 'unavailable';
    return `  ${source.label}: ${availability} (${source.state})`;
  });
  const databaseState = report.database.existedBeforeRuntime ? 'existing' : 'initialized';
  return [
    'Agent Profile doctor',
    `Database: ${report.database.path} (${databaseState})`,
    `Imports: ${report.imports.active ? 'active' : 'idle'} (not started by doctor)`,
    'Sources:',
    ...sourceLines,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatSourcesReport(report: CliSourcesReport | CliSyncReport): string {
  const sourceLines = report.sources.map((source) => {
    const result = source.result
      ? `; imported ${source.result.imported}, updated ${source.result.updated}, failed ${source.result.failed}`
      : '';
    return `  ${source.label}: ${source.available ? 'available' : 'unavailable'} (${source.state}); stored ${source.storedSessions}${result}`;
  });
  return [
    `Agent Profile ${report.command}`,
    `Imports: ${report.imports.active ? 'active' : 'idle'}${report.imports.operation ? ` (${report.imports.operation})` : ''}`,
    ...(report.command === 'sync'
      ? [`Requested sources: ${report.requestedSources.join(', ')}`]
      : []),
    'Sources:',
    ...sourceLines,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatServeReport(report: CliServeReport): string {
  return [
    'Agent Profile serve',
    `Web: ${report.url}`,
    `API: ${report.apiUrl}`,
    `Database: ${report.databasePath}`,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatSessionsReport(report: CliSessionsReport): string {
  const rows = report.sessions.map((session) => {
    const cost = session.costUnknownCount > 0 ? 'unknown' : session.totalCost.toFixed(6);
    return `  ${session.id}  ${session.agent}  ${new Date(session.startTime).toISOString()}  cost ${cost}`;
  });
  return [
    'Agent Profile sessions',
    `Returned: ${report.sessions.length}; limit ${report.limit}; ${report.hasMore ? 'more available' : 'end reached'}`,
    'Sessions:',
    ...rows,
    ...(report.nextCursor ? [`Next cursor: ${report.nextCursor}`] : []),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatStatsReport(report: CliStatsReport): string {
  const { overview } = report.statistics;
  return [
    'Agent Profile stats',
    `Sessions: ${overview.totalSessions}`,
    `Tokens: ${overview.totalTokens}`,
    `Cost: ${overview.sessionsWithCostUnknown > 0 ? 'partial' : overview.totalCost.toFixed(6)}`,
    `Agents: ${report.statistics.byAgent.length}; projects: ${report.statistics.byProject.length}`,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatProfilesReport(report: CliProfilesReport): string {
  const profile = report.agentProfiles;
  return [
    'Agent Profile profiles',
    `Agents: ${profile.scope.agents.join(', ') || 'none'}`,
    `Sessions: ${profile.scope.sessions}`,
    `Comparison: ${profile.comparison.status}`,
    ...profile.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatTaskProfileReport(report: CliTaskProfileReport): string {
  const profile = report.taskProfile;
  return [
    'Agent Profile task-profile',
    `Task: ${profile.task.title} (${profile.task.id})`,
    `State: ${profile.task.status} / ${profile.task.type}`,
    `Sessions: ${profile.profile.availableSessions}/${profile.profile.linkedSessions} available`,
    `Outcome coverage: ${profile.coverage.outcome.status}`,
    ...profile.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatDiagnosisReport(report: CliDiagnosisReport): string {
  return [
    'Agent Profile diagnosis',
    `Session: ${report.sessionId}`,
    `Findings: ${report.diagnosis.findings.length}`,
    `Wasted tokens: ${report.diagnosis.totalWastedTokens}`,
    ...report.diagnosis.findings.map(
      (finding) =>
        `  ${finding.severity} ${finding.type}  spans ${finding.spanIds.join(', ') || 'none'}`,
    ),
    ...report.diagnosis.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatEvidenceReport(report: CliEvidenceReport): string {
  return [
    'Agent Profile evidence',
    `Session: ${report.sessionId}`,
    `References: ${report.evidence.references.length}/${report.evidence.scope.events}`,
    ...report.evidence.references.map(
      (reference) =>
        `  #${reference.sequence} ${reference.type} ${reference.id} (${reference.outcome})`,
    ),
    ...report.evidence.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatTaskOutcomeReport(report: CliTaskOutcomeReport): string {
  return [
    'Agent Profile task-outcome',
    `Task: ${report.taskId}`,
    `Saved evidence: ${report.saved.kind}${report.saved.status ? ` (${report.saved.status})` : ''}`,
    `Evidence count: ${report.saved.evidenceCount}`,
    `Outcome coverage: ${report.saved.coverage.status}`,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatTaskFeedbackReport(report: CliTaskFeedbackReport): string {
  return [
    'Agent Profile task-feedback',
    `Task: ${report.taskId}`,
    `Reports: ${report.feedback.length}`,
    ...report.feedback.map((feedback) => `  ${String(feedback.status ?? 'unknown')}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}
