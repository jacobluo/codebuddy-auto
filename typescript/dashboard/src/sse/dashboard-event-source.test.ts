import { describe, expect, it } from 'vitest';

import { getDashboardEventsUrl } from './dashboard-event-source.js';

describe('dashboard event source helpers', () => {
  it('builds an events URL with or without an API base URL', () => {
    expect(getDashboardEventsUrl()).toBe('/api/v1/events');
    expect(getDashboardEventsUrl('http://127.0.0.1:4317')).toBe('http://127.0.0.1:4317/api/v1/events');
  });
});
