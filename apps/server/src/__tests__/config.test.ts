import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';

describe('server configuration', () => {
  it('uses loopback-only defaults and the standard source directory', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      webOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      autoScanDir: '~/.claude/projects',
      defaultScanDir: '~/.claude/projects',
    });
  });

  it('supports explicit ports, hosts, origins, and disabled startup scans', () => {
    expect(
      loadConfig({
        PORT: '4100',
        HOST: '0.0.0.0',
        WEB_ORIGIN: 'http://localhost:4101, https://profile.example.test ',
        AUTO_SCAN_DIR: '',
      }),
    ).toEqual({
      port: 4100,
      host: '0.0.0.0',
      webOrigins: ['http://localhost:4101', 'https://profile.example.test'],
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
  });

  it('falls back from invalid ports and blank network overrides', () => {
    expect(
      loadConfig({ PORT: '70000', HOST: ' ', WEB_ORIGIN: ' , ', AUTO_SCAN_DIR: '/tmp/history' }),
    ).toMatchObject({
      port: 3000,
      host: '127.0.0.1',
      webOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      autoScanDir: '/tmp/history',
    });
  });
});
