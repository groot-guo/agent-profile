import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const roadmapPath = 'docs/roadmap.md';
const archiveDirectory = 'docs/roadmap-archive';
const allowedCurrentStatuses = new Set(['planned', 'in_progress', 'blocked']);
const allowedArchiveStatuses = new Set(['completed', 'cancelled']);
const taskHeading = /^### (T\d+(?:\.\d+)?) (.+)$/gm;

function taskSections(path) {
  const content = readFileSync(path, 'utf8');
  const headings = [...content.matchAll(taskHeading)];
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? content.length;
    const section = content.slice(heading.index, end);
    const status = section.match(/^- status: ([a-z_]+)$/m)?.[1];
    return { id: heading[1], path, status, title: heading[2] };
  });
}

const errors = [];
const currentTasks = taskSections(roadmapPath);
const archiveFiles = readdirSync(archiveDirectory)
  .filter((file) => file.endsWith('.md'))
  .sort();
const archiveFileSet = new Set(archiveFiles);
const archivedTasks = archiveFiles.flatMap((file) => taskSections(join(archiveDirectory, file)));
const allTasks = [...currentTasks, ...archivedTasks];
const tasksById = new Map();

for (const task of allTasks) {
  const previous = tasksById.get(task.id);
  if (previous) {
    errors.push(`${task.id} appears in both ${previous.path} and ${task.path}`);
  } else {
    tasksById.set(task.id, task);
  }
  if (!task.status) errors.push(`${task.id} in ${task.path} has no status`);
}

for (const task of currentTasks) {
  if (!allowedCurrentStatuses.has(task.status)) {
    errors.push(`${task.id} has terminal or invalid status ${task.status} in ${roadmapPath}`);
  }
}
for (const task of archivedTasks) {
  if (!allowedArchiveStatuses.has(task.status)) {
    errors.push(`${task.id} has active or invalid status ${task.status} in ${task.path}`);
  }
}

const activeTasks = currentTasks.filter((task) => task.status === 'in_progress');
if (activeTasks.length > 1) {
  errors.push(`expected at most one in_progress Task, found ${activeTasks.length}`);
}

const roadmap = readFileSync(roadmapPath, 'utf8');
const archiveLinks = [
  ...roadmap.matchAll(/\[(T\d+(?:\.\d+)?)\]\(roadmap-archive\/([^#)]+)#([^)]+)\)/g),
];
const linkedIds = new Set();
for (const [, id, file, anchor] of archiveLinks) {
  if (!archiveFileSet.has(file)) {
    errors.push(`${id} links to an unregistered archive file ${file}`);
    continue;
  }
  const path = join(archiveDirectory, file);
  const archive = readFileSync(path, 'utf8');
  if (!archive.includes(`<a id="${anchor}"></a>`)) {
    errors.push(`${id} links to missing anchor ${anchor} in ${path}`);
  }
  if (!archivedTasks.some((task) => task.id === id && task.path === path)) {
    errors.push(`${id} has no Task body in its linked archive ${path}`);
  }
  if (anchor !== id.toLowerCase().replaceAll('.', '-')) {
    errors.push(`${id} uses non-canonical archive anchor ${anchor}`);
  }
  if (linkedIds.has(id)) errors.push(`${id} has more than one archive index link`);
  linkedIds.add(id);
}

for (const task of archivedTasks) {
  if (!linkedIds.has(task.id)) errors.push(`${task.id} is missing from the completed index`);
}
for (const id of linkedIds) {
  if (!archivedTasks.some((task) => task.id === id)) {
    errors.push(`${id} is indexed but has no archived Task body`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Roadmap valid: ${currentTasks.length} current, ${archivedTasks.length} archived, ${activeTasks.length} in progress.`,
  );
}
