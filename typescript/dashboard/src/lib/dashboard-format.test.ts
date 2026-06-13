import { describe, expect, it } from 'vitest';

import {
  formatClockTime,
  formatCompactNumber,
  formatDuration,
  formatUptime,
} from './dashboard-format.js';

describe('dashboard format helpers', () => {
  it('formats compact counts for raw, thousand, and million values', () => {
    expect(formatCompactNumber(42)).toBe('42');
    expect(formatCompactNumber(1_250)).toBe('1.3K');
    expect(formatCompactNumber(2_500_000)).toBe('2.5M');
  });

  it('formats durations while clamping negative values to zero', () => {
    expect(formatDuration(-10)).toBe('0s');
    expect(formatDuration(9.6)).toBe('10s');
    expect(formatDuration(125)).toBe('2m 05s');
  });

  it('formats valid clock and uptime values while tolerating invalid timestamps', () => {
    expect(formatClockTime('not-a-date')).toBe('--');
    expect(formatUptime('not-a-date', Date.parse('2026-06-13T10:01:05.000Z'))).toBe('--');
    expect(formatUptime('2026-06-13T10:00:00.000Z', Date.parse('2026-06-13T10:01:05.000Z'))).toBe('1m 05s');
  });
});
