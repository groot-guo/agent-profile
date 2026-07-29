#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api';

await tsImport('../src/bin.ts', import.meta.url);
