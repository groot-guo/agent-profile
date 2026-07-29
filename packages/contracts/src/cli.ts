import type { ImportSourceId, ImportSourceState } from './common';

export const CLI_SCHEMA_VERSION = 'agent-profile-cli/v1';

export type CliCommand = 'help' | 'version' | 'doctor';

export interface CliHelpReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'help';
  usage: string;
  commands: CliCommand[];
}

export interface CliVersionReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'version';
  version: string;
}

export interface CliDoctorSource {
  id: ImportSourceId;
  label: string;
  available: boolean;
  state: ImportSourceState;
}

export interface CliDoctorReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'doctor';
  database: {
    path: string;
    existedBeforeRuntime: boolean;
  };
  imports: {
    active: boolean;
  };
  sources: CliDoctorSource[];
  limitations: string[];
}

export type CliReport = CliHelpReport | CliVersionReport | CliDoctorReport;
