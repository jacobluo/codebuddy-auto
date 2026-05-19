import path from 'node:path';

import type { ServiceConfig } from '../spec/index.js';
import { LocalTracker } from '../tracker/index.js';

export function createLocalTracker(config: ServiceConfig): LocalTracker {
  return new LocalTracker({
    rootDir: path.join(config.workspace.root, '.tracker'),
    activeStates: config.tracker.activeStates,
  });
}
