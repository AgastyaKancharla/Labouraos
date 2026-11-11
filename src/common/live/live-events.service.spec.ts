import { LiveEventsService, LiveMessage } from './live-events.service';

describe('live channel (server to browser)', () => {
  it('delivers an event only to the staff member it is addressed to', () => {
    const live = new LiveEventsService();
    const a: LiveMessage[] = [];
    const b: LiveMessage[] = [];
    const subA = live.streamFor('staff-a').subscribe((m) => a.push(m));
    const subB = live.streamFor('staff-b').subscribe((m) => b.push(m));
    expect(live.publish('staff-a', 'incoming_call', { callbackTaskId: 't1' })).toBe(true);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'incoming_call', data: { callbackTaskId: 't1' } });
    expect(b).toHaveLength(0);
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('reaches every open screen of the same person, and reports when none is open', () => {
    const live = new LiveEventsService();
    const first: LiveMessage[] = [];
    const second: LiveMessage[] = [];
    const s1 = live.streamFor('staff-a').subscribe((m) => first.push(m));
    const s2 = live.streamFor('staff-a').subscribe((m) => second.push(m));
    expect(live.openScreens('staff-a')).toBe(2);
    live.publish('staff-a', 'call_status', { status: 'answered' });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    s1.unsubscribe();
    s2.unsubscribe();
    expect(live.openScreens('staff-a')).toBe(0);
    expect(live.publish('staff-a', 'call_status', { status: 'completed' })).toBe(false);
    expect(live.publish('', 'call_status', {})).toBe(false);
  });

  it('gives each event an increasing id so a reconnecting screen can tell them apart', () => {
    const live = new LiveEventsService();
    const got: LiveMessage[] = [];
    const sub = live.streamFor('x').subscribe((m) => got.push(m));
    live.publish('x', 'registration_step', { step: 'consent' });
    live.publish('x', 'registration_step', { step: 'selfie' });
    expect(Number(got[1]!.id)).toBeGreaterThan(Number(got[0]!.id));
    sub.unsubscribe();
  });
});
