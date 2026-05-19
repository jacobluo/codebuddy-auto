import type { ServiceConfig } from '../spec/index.js';
import { CnbTracker } from './cnb-tracker.js';
import { LocalTracker } from './local-tracker.js';
import type { Tracker } from './tracker.js';

export function createTracker(config: ServiceConfig): Tracker {
  if (config.tracker.kind === 'local') {
    return new LocalTracker({
      rootDir: `${config.workspace.root}/.tracker`,
      activeStates: config.tracker.activeStates,
    });
  }

  if (config.tracker.kind === 'cnb') {
    if (!config.tracker.endpoint) {
      throw new Error('tracker.endpoint is required for cnb tracker');
    }
    if (!config.tracker.projectSlug) {
      throw new Error('tracker.projectSlug is required for cnb tracker');
    }
    if (!config.tracker.apiKey) {
      throw new Error('tracker.apiKey is required for cnb tracker');
    }

    return new CnbTracker({
      apiBaseUrl: config.tracker.endpoint,
      repo: config.tracker.projectSlug,
      token: config.tracker.apiKey,
    });
  }

  throw new Error(`unsupported tracker kind: ${config.tracker.kind}`);
}
