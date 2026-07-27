import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findTranscriptFiles,
  findTranscriptFilesSync,
  readTranscript,
  readTranscriptSync,
} from '../scanners/transcript';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('generic transcript scanner', () => {
  it('discovers nested JSONL transcripts while excluding journals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-profile-transcript-'));
    roots.push(root);
    const nested = join(root, 'nested');
    mkdirSync(nested);
    writeFileSync(join(root, 'session-a.jsonl'), '{}\n');
    writeFileSync(join(nested, 'session-b.jsonl'), '{}\n');
    writeFileSync(join(nested, 'journal.jsonl'), '{}\n');
    writeFileSync(join(nested, 'notes.txt'), '{}\n');

    const expected = [join(root, 'session-a.jsonl'), join(nested, 'session-b.jsonl')].sort();
    await expect(findTranscriptFiles(root)).resolves.toEqual(expected);
    expect(findTranscriptFilesSync(root)).toEqual(expected);
  });

  it('reads typed NDJSON entries and skips blank, malformed, or untyped lines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-profile-transcript-'));
    roots.push(root);
    const transcript = join(root, 'session.jsonl');
    writeFileSync(
      transcript,
      [
        '',
        '{"type":"assistant","uuid":"a","timestamp":"2026-07-27T00:00:00Z"}',
        'not-json',
        '{"uuid":"missing-type"}',
        '{"type":"user","uuid":"b","timestamp":"2026-07-27T00:00:01Z"}',
      ].join('\n'),
    );

    const asyncEntries = await readTranscript(transcript);
    expect(asyncEntries.map((entry) => entry.type)).toEqual(['assistant', 'user']);
    expect(readTranscriptSync(transcript)).toEqual(asyncEntries);
  });
});
