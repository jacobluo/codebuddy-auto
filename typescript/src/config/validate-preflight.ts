import fs from 'node:fs';

import type { ServiceConfig } from '../spec/index.js';

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

export function validatePreflight(config: ServiceConfig): PreflightResult {
  const errors: string[] = [];

  if (config.tracker.kind.length === 0) {
    errors.push('tracker.kind is required');
  }
  if ((config.tracker.apiKey ?? '').length === 0) {
    errors.push('tracker.apiKey is required');
  }
  if (config.tracker.kind === 'cnb' && (config.tracker.endpoint ?? '').length === 0) {
    errors.push('tracker.endpoint is required for cnb tracker');
  }
  if (config.tracker.kind === 'cnb' && (config.tracker.projectSlug ?? '').length === 0) {
    errors.push('tracker.projectSlug is required for cnb tracker');
  }
  if (config.codebuddy.command.length === 0) {
    errors.push('codebuddy.command is required');
  }
  if (!fs.existsSync(config.workspace.root)) {
    errors.push(`workspace.root does not exist: ${config.workspace.root}`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
