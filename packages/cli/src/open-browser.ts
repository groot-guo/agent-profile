import { spawn } from 'node:child_process';

export interface BrowserLaunchCommand {
  command: string;
  args: string[];
}

export function browserLaunchCommand(
  url: string,
  currentPlatform: NodeJS.Platform = process.platform,
): BrowserLaunchCommand {
  if (currentPlatform === 'darwin') return { command: 'open', args: [url] };
  if (currentPlatform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export function openBrowser(url: string): Promise<void> {
  const launch = browserLaunchCommand(url);
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
