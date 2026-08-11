import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export type ProjectScopeMode = 'global' | 'project';
export type ProjectCwdClassification = 'included' | 'excluded' | 'unassigned';

export interface ProjectScopeDescriptor {
  mode: ProjectScopeMode;
  projectRoot: string | null;
  label: string;
}

export function normalizeProjectRoot(projectRoot?: string | null): string | null {
  const value = projectRoot?.trim();
  return value ? resolve(value) : null;
}

export function projectScopeDescriptor(projectRoot?: string | null): ProjectScopeDescriptor {
  const normalized = normalizeProjectRoot(projectRoot);
  return {
    mode: normalized ? 'project' : 'global',
    projectRoot: normalized,
    label: normalized ? basename(normalized) || normalized : 'global',
  };
}

export function classifyProjectCwd(
  cwd: string | null | undefined,
  projectRoot?: string | null,
): ProjectCwdClassification {
  if (!cwd?.trim()) return 'unassigned';
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  if (!normalizedRoot) return 'included';
  return isProjectCwd(cwd, normalizedRoot) ? 'included' : 'excluded';
}

export function isProjectCwd(cwd: string, projectRoot: string): boolean {
  const relation = relative(resolve(projectRoot), resolve(cwd));
  return (
    relation === '' ||
    (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  );
}

export function projectScopeSql(
  projectRoot: string | null | undefined,
  alias: string,
): { clause: string; parameters: Array<string | number> } {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  if (!normalizedRoot) return { clause: '1 = 1', parameters: [] };
  return {
    clause: `(${alias}.cwd = ? OR (${alias}.cwd IS NOT NULL
      AND substr(${alias}.cwd, 1, ?) = ?
      AND substr(${alias}.cwd, ? + 1, 1) = ?))`,
    parameters: [normalizedRoot, normalizedRoot.length, normalizedRoot, normalizedRoot.length, sep],
  };
}
