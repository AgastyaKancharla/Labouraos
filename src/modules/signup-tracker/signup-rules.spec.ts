import { SIGNUP_SETTING_DEFAULTS, missingSettingColumns, signupSettingsFrom } from './signup-settings';
import { addWorkingMinutes, callWindow, istDateKey, nextCallableAt, nextWorkingMorning, reminderAt, WorkCalendar } from './signup-timing';
import { assistedBy, firstCallAt, planNext, PlanInput } from './signup-plan';
import { AssignmentCandidate, languageCode, pickAgent } from './signup-assignment';
import { businessStage, noRecordStage, referralStage, seekerStage } from './signup-stage';

/** IST wall clock → UTC instant. */
const ist = (s: string) => new Date(`${s}:00+05:30`);

const policy = {
  callingHoursStart: '09:00',
  callingHoursEnd: '21:00',
  shiftStart: '09:30',
  shiftEnd: '18:30',
  weeklyOffDays: [0],
};
const settings = signupSettingsFrom(policy);
const plain: WorkCalendar = { weeklyOffDays: [0], holidays: new Set() };
const withHoliday: WorkCalendar = { weeklyOffDays: [0], holidays: new Set(['2026-11-16']) };
const window = callWindow(settings);

describe('Sign-up settings (CEO-editable, defaults until the Settings columns exist)', () => {
  it('uses the confirmed defaults: 30 min and 4 h reminders, 2 working hours at payment, 3 tries over 3 days', () => {
    expect(settings).toMatchObject({
      firstReminderMinutes: 30,
      secondReminderMinutes: 240,
      businessCallMinutes: 240,
      paymentStopWorkingMinutes: 120,
      maxCallTries: 3,
      callTryDays: 3,
      callingHoursStart: '09:00',
      callingHoursEnd: '21:00',
      workdayStart: '09:30',
    });
    expect(missingSettingColumns(policy)).toEqual(Object.keys(SIGNUP_SETTING_DEFAULTS));
  });

  it('reads a value from the policy row once its column exists', () => {
    const s = signupSettingsFrom({ ...policy, signupFirstReminderMinutes: 45, signupMaxCallTries: 0 } as typeof policy);
    expect(s.firstReminderMinutes).toBe(45);
    // Nonsense values fall back to the default.
    expect(s.maxCallTries).toBe(3);
    expect(missingSettingColumns({ ...policy, signupFirstReminderMinutes: 45 })).not.toContain('signupFirstReminderMinutes');
  });
});

describe('Working time: calling hours, working days, holidays', () => {
  it('the call window is the shift inside the calling hours, narrowed to the person’s window', () => {
    expect(window).toEqual({ start: 9 * 60 + 30, end: 18 * 60 + 30 });
    expect(callWindow(settings, { start: '18:00', end: '21:00' })).toEqual({ start: 18 * 60, end: 18 * 60 + 30 });
    // No overlap with the shift: the shift inside the calling hours is used.
    expect(callWindow(settings, { start: '19:00', end: '21:00' })).toEqual(window);
  });

  it('"next working morning" skips the weekly day off and public holidays', () => {
    // Friday 15:00 → Saturday 09:30 (only Sunday is off).
    expect(nextWorkingMorning(ist('2026-11-13T15:00'), plain, window)).toEqual(ist('2026-11-14T09:30'));
    // Saturday 15:00 → Monday 09:30.
    expect(nextWorkingMorning(ist('2026-11-14T15:00'), plain, window)).toEqual(ist('2026-11-16T09:30'));
    // Monday is a holiday → Tuesday.
    expect(nextWorkingMorning(ist('2026-11-14T15:00'), withHoliday, window)).toEqual(ist('2026-11-17T09:30'));
    // Stopped before the day starts on a working day: this morning.
    expect(nextWorkingMorning(ist('2026-11-14T08:00'), plain, window)).toEqual(ist('2026-11-14T09:30'));
  });

  it('adds working hours only inside the call window on working days (payment-stopped: 2 working hours)', () => {
    expect(addWorkingMinutes(ist('2026-11-13T10:00'), 120, plain, window)).toEqual(ist('2026-11-13T12:00'));
    // 60 minutes left on Friday, the rest on Saturday morning.
    expect(addWorkingMinutes(ist('2026-11-13T17:30'), 120, plain, window)).toEqual(ist('2026-11-14T10:30'));
    // Saturday evening: 90 minutes on Saturday, Sunday off, 30 on Monday.
    expect(addWorkingMinutes(ist('2026-11-14T17:00'), 120, plain, window)).toEqual(ist('2026-11-16T10:00'));
    expect(addWorkingMinutes(ist('2026-11-14T17:00'), 120, withHoliday, window)).toEqual(ist('2026-11-17T10:00'));
    // Stopped at night (quiet hours): counted from the next working morning.
    expect(addWorkingMinutes(ist('2026-11-14T22:00'), 120, plain, window)).toEqual(ist('2026-11-16T11:30'));
  });

  it('never makes a call due outside calling hours, on a day off or on a holiday', () => {
    expect(nextCallableAt(ist('2026-11-13T20:00'), plain, window)).toEqual(ist('2026-11-14T09:30'));
    expect(nextCallableAt(ist('2026-11-15T11:00'), plain, window)).toEqual(ist('2026-11-16T09:30'));
    expect(nextCallableAt(ist('2026-11-16T11:00'), withHoliday, window)).toEqual(ist('2026-11-17T09:30'));
    expect(nextCallableAt(ist('2026-11-13T11:00'), plain, window)).toEqual(ist('2026-11-13T11:00'));
    expect(istDateKey(ist('2026-11-16T00:10').getTime())).toBe('2026-11-16');
  });

  it('reminders wait out quiet hours (9 PM to 9 AM), any day of the week', () => {
    expect(reminderAt(ist('2026-11-13T14:00'), 30, settings)).toEqual(ist('2026-11-13T14:30'));
    expect(reminderAt(ist('2026-11-13T20:45'), 30, settings)).toEqual(ist('2026-11-14T09:00'));
    expect(reminderAt(ist('2026-11-15T07:00'), 30, settings)).toEqual(ist('2026-11-15T09:00'));
  });
});

describe('The plan for an unfinished sign-up', () => {
  const base = (over: Partial<PlanInput>): PlanInput => ({
    profileKind: 'job_seeker',
    stage: 'C',
    stoppedAt: ist('2026-11-13T10:00'),
    remindersSent: 0,
    callTries: 0,
    callable: true,
    lastCallDueAt: null,
    personWindow: window,
    ...over,
  });

  it('job seeker: reminder at 30 minutes, again at 4 hours, call task the next working morning', () => {
    expect(planNext(base({}), settings, plain)).toEqual({ action: 'reminder', at: ist('2026-11-13T10:30') });
    expect(planNext(base({ remindersSent: 1 }), settings, plain)).toEqual({ action: 'reminder', at: ist('2026-11-13T14:00') });
    expect(planNext(base({ remindersSent: 2 }), settings, plain)).toEqual({ action: 'call_task', at: ist('2026-11-14T09:30') });
  });

  it('job seeker stopped at payment (stage E): called after 2 working hours, before the 4-hour reminder', () => {
    expect(planNext(base({ stage: 'E', remindersSent: 1 }), settings, plain)).toEqual({ action: 'call_task', at: ist('2026-11-13T12:00') });
    expect(firstCallAt(base({ stage: 'E', stoppedAt: ist('2026-11-14T17:00') }), settings, withHoliday)).toEqual(ist('2026-11-17T10:00'));
  });

  it('business: one reminder, then a call task 4 hours after stopping (inside the call window)', () => {
    expect(planNext(base({ profileKind: 'business' }), settings, plain)).toEqual({ action: 'reminder', at: ist('2026-11-13T10:30') });
    expect(planNext(base({ profileKind: 'business', remindersSent: 1 }), settings, plain)).toEqual({ action: 'call_task', at: ist('2026-11-13T14:00') });
    // 15:00 + 4 h = 19:00, after the shift: Saturday morning.
    expect(planNext(base({ profileKind: 'business', remindersSent: 1, stoppedAt: ist('2026-11-13T15:00') }), settings, plain)).toEqual({
      action: 'call_task',
      at: ist('2026-11-14T09:30'),
    });
  });

  it('3 tries over 3 days, one a working day, then closed', () => {
    const second = planNext(base({ remindersSent: 2, callTries: 1, lastCallDueAt: ist('2026-11-14T09:30') }), settings, plain);
    expect(second).toEqual({ action: 'call_task', at: ist('2026-11-16T09:30') });
    const closed = planNext(base({ remindersSent: 2, callTries: 3, lastCallDueAt: ist('2026-11-17T09:30') }), settings, plain);
    expect(closed.action).toBe('close');
    expect(closed.at).toEqual(ist('2026-11-18T09:30'));
  });

  it('without the contact-me tick (or before a record exists): reminders only, never a call', () => {
    expect(planNext(base({ callable: false }), settings, plain).action).toBe('reminder');
    const waiting = planNext(base({ callable: false, remindersSent: 2 }), settings, plain);
    expect(waiting.action).toBe('wait');
  });
});

describe('Assignment order: existing agent → on shift → language → fewest open tasks', () => {
  const agent = (id: string, over: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
    id,
    code: id.toUpperCase(),
    onShift: true,
    isOwnerAccount: false,
    signedIn: true,
    spokenLanguages: ['Kannada'],
    openSignupTasks: 0,
    lastSignupAssignedAt: null,
    ...over,
  });

  it('gives it to the agent who registered or already spoke to the person, when on shift', () => {
    const pick = pickAgent({ candidates: [agent('a'), agent('b', { openSignupTasks: 9 })], existingAgentIds: ['b'], language: 'kn' });
    expect(pick).toEqual({ staffId: 'b', reason: 'existing_agent' });
  });

  it('skips anyone not on shift (not started the day, or on leave), even the existing agent', () => {
    const pick = pickAgent({
      candidates: [agent('a', { onShift: false }), agent('b', { openSignupTasks: 4 })],
      existingAgentIds: ['a'],
      language: 'kn',
    });
    expect(pick).toEqual({ staffId: 'b', reason: 'handover' });
    expect(pickAgent({ candidates: [agent('a', { onShift: false })], existingAgentIds: [], language: null })).toBeNull();
  });

  it('prefers an agent who speaks the person’s language, then the fewest open sign-up tasks', () => {
    const pick = pickAgent({
      candidates: [agent('a', { spokenLanguages: ['Kannada'] }), agent('b', { spokenLanguages: ['Hindi', 'English'], openSignupTasks: 5 }), agent('c', { spokenLanguages: ['hi'], openSignupTasks: 2 })],
      existingAgentIds: [],
      language: 'hi',
    });
    expect(pick).toEqual({ staffId: 'c', reason: 'language' });
  });

  it('falls back to everyone on shift when nobody speaks the language, fewest tasks first', () => {
    const pick = pickAgent({ candidates: [agent('a', { openSignupTasks: 3 }), agent('b', { openSignupTasks: 1 })], existingAgentIds: [], language: 'en' });
    expect(pick).toEqual({ staffId: 'b', reason: 'fair_share' });
  });

  it('breaks ties round-robin: whoever got one least recently', () => {
    const pick = pickAgent({
      candidates: [agent('a', { lastSignupAssignedAt: new Date('2026-11-13T05:00:00Z') }), agent('b', { lastSignupAssignedAt: new Date('2026-11-13T04:00:00Z') })],
      existingAgentIds: [],
      language: 'kn',
    });
    expect(pick?.staffId).toBe('b');
  });

  it('owner accounts have no attendance: available while signed in, not otherwise', () => {
    const owner = agent('owner', { onShift: false, isOwnerAccount: true, signedIn: true });
    expect(pickAgent({ candidates: [owner], existingAgentIds: [], language: 'kn' })?.staffId).toBe('owner');
    const away = agent('owner', { onShift: true, isOwnerAccount: true, signedIn: false });
    expect(pickAgent({ candidates: [away], existingAgentIds: [], language: 'kn' })).toBeNull();
  });

  it('reads language names and codes the same way', () => {
    expect(languageCode('Kannada')).toBe('kn');
    expect(languageCode('ಕನ್ನಡ')).toBe('kn');
    expect(languageCode('HI')).toBe('hi');
    expect(languageCode('Tamil')).toBe('tamil');
  });
});

describe('Stages from the records', () => {
  const seeker = {
    consentDone: false,
    selfie: false,
    idVerified: false,
    idFailed: false,
    idServiceDown: false,
    termsAgreed: false,
    paymentFailures: 0,
    paid: false,
  };

  it('job seeker: B → C consent → D selfie and ID → E terms → done when ₹499 arrives', () => {
    expect(seekerStage(seeker)).toMatchObject({ stage: 'B', step: 'consent' });
    expect(seekerStage({ ...seeker, consentDone: true })).toMatchObject({ stage: 'C', step: 'selfie' });
    expect(seekerStage({ ...seeker, consentDone: true, selfie: true, idVerified: true })).toMatchObject({ stage: 'D', missing: ['terms', 'payment'] });
    const atPayment = seekerStage({ ...seeker, consentDone: true, selfie: true, idVerified: true, termsAgreed: true, paymentFailures: 2 });
    expect(atPayment).toMatchObject({ stage: 'E', step: 'payment_failed', stuckReason: 'UPI failed 2 times' });
    expect(seekerStage({ ...seeker, paid: true }).stage).toBe('done');
  });

  it('business: agreement, visit booked, visit done, verified', () => {
    const b = { agreementSigned: false, visitBooked: false, visitRequested: true, visitDone: false, verified: false, rejected: false };
    expect(businessStage(b)).toMatchObject({ stage: 'B', stuckReason: 'Visit not assigned yet' });
    expect(businessStage({ ...b, agreementSigned: true }).stage).toBe('C');
    expect(businessStage({ ...b, agreementSigned: true, visitBooked: true }).stage).toBe('D');
    expect(businessStage({ ...b, visitDone: true }).stage).toBe('E');
    expect(businessStage({ ...b, verified: true }).stage).toBe('done');
  });

  it('referral partner: terms, selfie and ID, UPI added, UPI checked', () => {
    const r = { termsAccepted: true, selfie: true, idVerified: true, idFailed: false, upiAdded: true, upiVerified: false, upiNameMismatch: true };
    expect(referralStage(r)).toMatchObject({ stage: 'E', stuckReason: "UPI name didn't match" });
    expect(referralStage({ ...r, upiVerified: true }).stage).toBe('done');
    expect(noRecordStage('business')).toMatchObject({ stage: 'A', step: 'business_form' });
  });
});

describe('Target credit: self-finished credits nobody; assisted needs a connected call or GPS visit', () => {
  const assignedAt = new Date('2026-11-13T05:00:00Z');
  const finishedAt = new Date('2026-11-13T09:00:00Z');
  const base = { assignedStaffId: 'ca1', assignedAt, finishedAt, connectedCalls: [], gpsVisits: [] };

  it('no assigned agent, or no proof: nobody', () => {
    expect(assistedBy({ ...base, assignedStaffId: null })).toBeNull();
    expect(assistedBy(base)).toBeNull();
  });

  it('the assigned agent’s connected call between assignment and finishing: that agent', () => {
    expect(assistedBy({ ...base, connectedCalls: [{ staffId: 'ca1', at: new Date('2026-11-13T06:00:00Z') }] })).toBe('ca1');
  });

  it('a call before the assignment, after finishing, or by someone else does not count', () => {
    expect(assistedBy({ ...base, connectedCalls: [{ staffId: 'ca1', at: new Date('2026-11-13T04:00:00Z') }] })).toBeNull();
    expect(assistedBy({ ...base, connectedCalls: [{ staffId: 'ca1', at: new Date('2026-11-13T10:00:00Z') }] })).toBeNull();
    expect(assistedBy({ ...base, connectedCalls: [{ staffId: 'ca2', at: new Date('2026-11-13T06:00:00Z') }] })).toBeNull();
  });

  it('a GPS visit by the assigned agent counts', () => {
    expect(assistedBy({ ...base, gpsVisits: [{ staffId: 'ca1', at: new Date('2026-11-13T07:00:00Z') }] })).toBe('ca1');
  });
});
