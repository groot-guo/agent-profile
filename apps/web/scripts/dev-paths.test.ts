import { describe, expect, it } from 'vitest';
import { developmentDistDir, developmentTsconfigPath, parseDevInvocation } from './dev-paths.mjs';

describe('Web development cache paths', () => {
  it('uses a deterministic cache directory for the requested port', () => {
    expect(parseDevInvocation([])).toEqual({ port: 3001, nextArgs: [] });
    expect(developmentDistDir(3001)).toBe('.next-dev-3001');
    expect(developmentDistDir(43101)).toBe('.next-dev-43101');
    expect(developmentTsconfigPath('.next-dev-43101')).toBe('.next-dev-43101.tsconfig.json');
  });

  it('removes port arguments before forwarding the remaining Next arguments', () => {
    expect(parseDevInvocation(['--', '--port', '43101', '--turbopack'])).toEqual({
      port: 43101,
      nextArgs: ['--turbopack'],
    });
    expect(parseDevInvocation(['-p', '43102', '--turbopack'])).toEqual({
      port: 43102,
      nextArgs: ['--turbopack'],
    });
  });

  it('permits only local generated-cache overrides', () => {
    expect(developmentDistDir(43101, '.next-dev-isolated')).toBe('.next-dev-isolated');
    expect(() => developmentDistDir(43101, '../.next')).toThrow('NEXT_DEV_DIST_DIR');
  });

  it('keeps the development server on loopback', () => {
    expect(() => parseDevInvocation(['--hostname', '0.0.0.0'])).toThrow(
      'Development hostname is fixed to 127.0.0.1',
    );
    expect(() => parseDevInvocation(['-H0.0.0.0'])).toThrow(
      'Development hostname is fixed to 127.0.0.1',
    );
  });
});
