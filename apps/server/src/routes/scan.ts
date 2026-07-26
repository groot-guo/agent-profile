import type { ScanResult } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getPricing } from '../db';
import { importFromSource } from '../ingestion/import-coordinator';
import { MiMoSourceAdapter } from '../ingestion/mimo-adapter';
import { SessionRepository } from '../ingestion/session-repository';
import { TranscriptSourceAdapter } from '../ingestion/transcript-adapter';
import { ZedSourceAdapter, type ZedSourceAdapterOptions } from '../ingestion/zed-adapter';

interface ScanBody {
  dir: string;
  agent?: string;
}

const sessionRepository = new SessionRepository(db, getPricing);

export function registerScanRoutes(app: FastifyInstance) {
  app.post<{ Body: ScanBody }>('/api/scan', async (request, reply) => {
    const { dir, agent } = request.body;
    if (!dir) return reply.status(400).send({ error: 'dir required' });
    return scanTranscriptDirectory(dir, agent);
  });
}

export function scanTranscriptDirectory(
  directory: string,
  agent?: string,
  repository = sessionRepository,
): Promise<ScanResult> {
  return importFromSource(new TranscriptSourceAdapter(directory, agent), repository);
}

export function autoScan(directory: string): Promise<ScanResult> {
  return scanTranscriptDirectory(directory);
}

export function scanZedThreads(
  options: ZedSourceAdapterOptions = {},
  repository = sessionRepository,
): Promise<ScanResult> {
  return importFromSource(new ZedSourceAdapter(options), repository);
}

export function scanMiMoSessions(
  databasePath?: string,
  repository = sessionRepository,
): Promise<ScanResult> {
  return importFromSource(new MiMoSourceAdapter(databasePath), repository);
}
