import type { AgentProfileReport, TaskProfileReport } from '@agent-profile/core';
import { buildProfileReport } from './routes/profiles';
import { buildStatsReport, type StatsReport } from './routes/stats';
import type { AppRuntime } from './runtime';
import { TaskRepository } from './task-repository';

export function getStatsReport(runtime: Pick<AppRuntime, 'database'>): StatsReport {
  return buildStatsReport(runtime.database);
}

export function getAgentProfileReport(
  runtime: Pick<AppRuntime, 'database' | 'clock'>,
): AgentProfileReport {
  return buildProfileReport(runtime.database, runtime.clock());
}

export function getTaskProfileReport(
  runtime: Pick<AppRuntime, 'database'>,
  taskId: string,
): TaskProfileReport {
  return new TaskRepository(runtime.database).buildProfile(taskId);
}
