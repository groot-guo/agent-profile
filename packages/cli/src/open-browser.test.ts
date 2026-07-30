import { describe, expect, it } from 'vitest';
import { browserLaunchCommand } from './open-browser';

describe('browser launch command', () => {
  it('uses shell-free platform commands', () => {
    expect(browserLaunchCommand('http://127.0.0.1:3000', 'darwin')).toEqual({
      command: 'open',
      args: ['http://127.0.0.1:3000'],
    });
    expect(browserLaunchCommand('http://127.0.0.1:3000', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['http://127.0.0.1:3000'],
    });
    expect(browserLaunchCommand('http://127.0.0.1:3000', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://127.0.0.1:3000'],
    });
  });
});
