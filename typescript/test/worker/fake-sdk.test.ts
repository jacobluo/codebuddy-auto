import { describe, expect, it } from 'vitest';

import {
  assistantText,
  createFakeSdk,
  resultSuccess,
  systemInit,
} from './fake-sdk.js';

describe('FakeSdk', () => {
  it('drives one happy turn from connect → send → stream → result', async () => {
    const fake = createFakeSdk({
      sessionId: 's1',
      turns: [
        {
          messages: [
            systemInit('s1'),
            assistantText('s1', 'doing turn 1'),
            resultSuccess('s1'),
          ],
        },
      ],
    });

    const session = fake.createSession({ cwd: '/tmp/fake' });

    expect(session.sessionId).toBe('s1');

    await session.connect();
    await session.send('hello world');

    const types: string[] = [];
    for await (const m of session.stream()) {
      types.push(m.type);
      if (m.type === 'result') break;
    }

    expect(types).toEqual(['system', 'assistant', 'result']);

    const recorded = fake.sessions[0]!;
    expect(recorded.sentMessages).toEqual(['hello world']);
    expect(recorded.turnCount).toBe(1);
    expect(recorded.closed).toBe(false);

    session.close();
    expect(recorded.closed).toBe(true);
  });
});
