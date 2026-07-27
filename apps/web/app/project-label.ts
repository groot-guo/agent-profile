export function projectLabel(project: string): string {
  if (project === '/') return '系统根目录';
  const normalized = project.replace(/\/+$/, '');
  return normalized.split('/').pop() || project;
}
