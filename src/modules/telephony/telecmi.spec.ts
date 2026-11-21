import { TeleCmiTelephonyProvider, TELECMI_CLICK_TO_CALL_URL, mapTeleCmiReport, plausiblePhone, teleCmiAgentMap, teleCmiKeyMatches } from './telecmi';

/**
 * TeleCMI (21 Nov fixes), from TeleCMI's public docs: click to call
 * (adminConnect) and the call reports (CDR) sent to our webhook.
 */
describe('TeleCMI calling company', () => {
  const KEY = 'telecmi_webhook_key_for_tests_32_chars_x';

  describe('webhook key (TeleCMI signs nothing)', () => {
    it('accepts only the exact key, compared in constant time; no key or a short key set refuses everything', () => {
      expect(teleCmiKeyMatches(KEY, KEY)).toBe(true);
      expect(teleCmiKeyMatches(`${KEY}x`, KEY)).toBe(false);
      expect(teleCmiKeyMatches(undefined, KEY)).toBe(false);
      expect(teleCmiKeyMatches('', '')).toBe(false);
      expect(teleCmiKeyMatches('short', 'short')).toBe(false);
    });
  });

  describe('call reports', () => {
    it('an incoming missed call goes on the missed-call list, by its number', () => {
      const report = mapTeleCmiReport(
        { appid: 1111113, type: 'cdr', direction: 'inbound', cmiuuid: '5f0f', status: 'missed', from: 9110000000, time: 1570114018000, waitedsec: 119 },
        '1111113',
        new Date(1570114018000),
      );
      expect(report).toEqual({ kind: 'missed_inbound', callId: 'telecmi:5f0f', callerPhone: '9110000000', at: new Date(1570114018000) });
    });

    it('an outgoing answered call: completed, answered, its length, and our call record from the custom value', () => {
      const report = mapTeleCmiReport(
        { type: 'cdr', appid: 1111113, to: 9100000000, cmiuuid: '760d', status: 'answered', user: '103_1111113', time: 1570184401056, direction: 'outbound', answeredsec: 13, click_to_call: 'true', record: 'true', filename: 'x.mp3', custom: 'call-record-1' },
        '1111113',
        new Date(1570184401056),
      );
      expect(report).toMatchObject({
        kind: 'status',
        callRecordId: 'call-record-1',
        agentId: '103_1111113',
        event: { provider: 'telecmi', status: 'completed', answered: true, durationSec: 13, direction: 'outbound', startedAt: new Date(1570184401056), endedAt: new Date(1570184414056) },
      });
    });

    it('an outgoing missed call is no answer (the retry rules follow)', () => {
      const report = mapTeleCmiReport({ type: 'cdr', appid: 7, to: 9100000000, cmiuuid: 'deb1', status: 'missed', user: '103_7', time: 1570184113597, direction: 'outbound' }, '7', new Date(1570184113597));
      expect(report).toMatchObject({ kind: 'status', event: { status: 'no_answer', answered: false, durationSec: 0, providerCallId: 'deb1' } });
    });

    it('refuses everything without our app id, old or future reports (more than 24 h away) and junk numbers', () => {
      const missed = { appid: 7, type: 'cdr', direction: 'inbound', cmiuuid: 'x1', status: 'missed', from: 9110000000, time: 1570114018000 };
      expect(mapTeleCmiReport(missed, undefined, new Date(1570114018000))).toEqual({ kind: 'ignored', reason: 'app id not set' });
      expect(mapTeleCmiReport(missed, '7', new Date(1570114018000 + 25 * 3600_000))).toEqual({ kind: 'ignored', reason: 'report time out of range' });
      expect(mapTeleCmiReport({ ...missed, time: undefined }, '7', new Date(1570114018000))).toEqual({ kind: 'ignored', reason: 'no report time' });
      for (const from of ['12345', 'abc9110000000', '9110000000999999', '<script>']) {
        expect(mapTeleCmiReport({ ...missed, from }, '7', new Date(1570114018000))).toEqual({ kind: 'ignored', reason: 'missed call with no valid number' });
      }
      expect(plausiblePhone('+91 98123 00001')).toBe(true);
      expect(plausiblePhone('09812300001')).toBe(true);
    });

    it('ignores live events, another app and reports without a call id', () => {
      expect(mapTeleCmiReport({ type: 'event', appid: 7, cmiuuid: 'a' }, '7')).toMatchObject({ kind: 'ignored' });
      expect(mapTeleCmiReport({ type: 'cdr', appid: 8, cmiuuid: 'a', direction: 'inbound', status: 'missed', from: 9100000000 }, '7')).toEqual({ kind: 'ignored', reason: 'another app' });
      expect(mapTeleCmiReport({ type: 'cdr', appid: 7, direction: 'inbound', status: 'missed', from: 9100000000 }, '7')).toEqual({ kind: 'ignored', reason: 'no call id' });
    });
  });

  describe('click to call', () => {
    const agents = teleCmiAgentMap('{"+91 98123 00001":"101_1111112","bad":"x"}');

    it('reads the agent map by the 10-digit calling phone', () => {
      expect([...agents.entries()]).toEqual([['9812300001', '101_1111112']]);
    });

    it('asks TeleCMI to ring the agent, then the person, with our call record as the custom value', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 200, msg: 'Call initiated', request_id: 'req-1' }) });
      const provider = new TeleCmiTelephonyProvider({} as never, {} as never, { secret: 'app-secret', agents, fetchImpl: fetchImpl as never });
      const result = await provider.initiateOutboundCall({ agentPhone: '+919812300001', customerPhone: '+919900011122', recordCall: true, metadata: { callRecordId: 'cr-1' } });
      expect(result).toMatchObject({ callId: 'req-1', status: 'initiated' });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe(TELECMI_CLICK_TO_CALL_URL);
      expect(JSON.parse(init.body)).toEqual({ agent_id: '101_1111112', token: 'app-secret', to: '9900011122', custom: 'cr-1' });
      expect(provider.getCapacity().vendor).toBe('telecmi');
    });

    it('says why when the agent has no TeleCMI id, the secret is missing or TeleCMI refuses', async () => {
      const refused = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 401, msg: 'Authentication failed' }) });
      const noAgent = new TeleCmiTelephonyProvider({} as never, {} as never, { secret: 's', agents, fetchImpl: refused as never });
      expect(await noAgent.initiateOutboundCall({ agentPhone: '+919000000000', customerPhone: '+919900011122' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/No TeleCMI agent/) });
      const noSecret = new TeleCmiTelephonyProvider({} as never, {} as never, { secret: '', agents, fetchImpl: refused as never });
      expect(await noSecret.initiateOutboundCall({ agentPhone: '+919812300001', customerPhone: '+919900011122' })).toMatchObject({ status: 'failed', error: 'TELECMI_SECRET is not set' });
      const provider = new TeleCmiTelephonyProvider({} as never, {} as never, { secret: 's', agents, fetchImpl: refused as never });
      expect(await provider.initiateOutboundCall({ agentPhone: '+919812300001', customerPhone: '+919900011122' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/refused the call \(401: Authentication failed\)/) });
    });
  });
});
