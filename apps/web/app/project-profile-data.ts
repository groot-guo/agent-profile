export type ProjectProfileRange = 'all' | '7d' | '30d' | '90d';

export function projectProfileUrl(
  api: string,
  project: string,
  range: ProjectProfileRange,
): string {
  return `${api}/projects/${encodeURIComponent(project)}/profile?range=${range}`;
}

export function projectProfileUpdateState(
  currentVersion: number,
  receivedVersion: number,
): { version: number; shouldRefresh: boolean } {
  if (receivedVersion <= currentVersion) {
    return { version: currentVersion, shouldRefresh: false };
  }
  return { version: receivedVersion, shouldRefresh: true };
}
