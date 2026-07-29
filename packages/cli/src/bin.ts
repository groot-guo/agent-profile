import { createDefaultCliDependencies } from './main';
import { runCli } from './runner';

process.exitCode = await runCli(process.argv.slice(2), createDefaultCliDependencies());
