import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './liveChannel';

describe('reading the live channel', () => {
  it('splits Server-Sent Events into typed events and keeps a partial block for later', () => {
    const { events, rest } = parseSseChunk(
      'event: ready\nretry: 3000\ndata: {"staffId":"s1"}\n\nevent: incoming_call\nid: 7\ndata: {"callbackTaskId":"t1","known":true}\n\nevent: call_st',
    );
    expect(events).toEqual([
      { type: 'ready', id: undefined, data: { staffId: 's1' } },
      { type: 'incoming_call', id: '7', data: { callbackTaskId: 't1', known: true } },
    ]);
    expect(rest).toBe('event: call_st');
  });

  it('ignores comments and blocks without data', () => {
    expect(parseSseChunk(': keep-alive\n\nevent: ping\n\n').events).toEqual([]);
  });
});
