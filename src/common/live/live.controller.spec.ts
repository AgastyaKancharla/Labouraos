import { Subscription } from 'rxjs';
import { LIVE_SESSION_CHECK_MS, LiveController } from './live.controller';
import { LiveEventsService } from './live-events.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The live events stream stops when its session is ended (locked, deactivated,
 * device revoked, revoked), not only when the token expires.
 */
describe('LiveController: the stream ends with its session', () => {
  let live: LiveEventsService;
  type Row = { revokedAt: Date | null; staff: { status: string }; lastActivityAt?: Date; absoluteExpiresAt?: Date };
  let session: Row | null;
  /** A live session: active just now, two hours left. */
  const live_ = (over: Partial<Row> = {}): Row => ({
    revokedAt: null,
    staff: { status: 'active' },
    lastActivityAt: new Date(Date.now()),
    absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    ...over,
  });
  let failLookup: boolean;
  let subscription: Subscription | undefined;
  const prisma = {
    staffSession: {
      findUnique: jest.fn(async () => {
        if (failLookup) throw new Error('database unavailable');
        return session;
      }),
    },
    staff: { findUnique: jest.fn(async () => ({ status: session?.staff.status ?? 'active' })) },
  };

  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  function open(sid: string | undefined = 'sess-1') {
    const controller = new LiveController(live, prisma as unknown as PrismaService, { current: async () => ({ idleLogoutMinutes: 60 }) } as never);
    const exp = Math.floor(Date.now() / 1000) + 15 * 60;
    const received: Array<{ type?: string }> = [];
    let completed = false;
    subscription = controller
      .events({ user: { sub: 'staff-1', role: 'call_agent', code: 'CA-1', email: null, sid, exp } } as never)
      .subscribe({ next: (m) => received.push(m), complete: () => { completed = true; } });
    return { received, isCompleted: () => completed };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    live = new LiveEventsService();
    session = live_();
    failLookup = false;
    prisma.staffSession.findUnique.mockClear();
  });

  afterEach(() => {
    subscription?.unsubscribe();
    live.onModuleDestroy();
    jest.useRealTimers();
  });

  it('closes at once when a session-ending action asks for a check and the session was revoked', async () => {
    const stream = open();
    jest.advanceTimersByTime(1);
    live.publish('staff-1', 'notification', { n: 1 });
    expect(stream.received.map((m) => m.type)).toEqual(['ready', 'notification']);

    session = live_({ revokedAt: new Date() });
    live.recheckSessions('staff-1');
    await flush();
    expect(stream.isCompleted()).toBe(true);

    live.publish('staff-1', 'notification', { n: 2 });
    expect(stream.received.map((m) => m.type)).toEqual(['ready', 'notification']);
  });

  it('closes on its periodic check when the account was deactivated elsewhere', async () => {
    const stream = open();
    session = live_({ staff: { status: 'deactivated' } });
    jest.advanceTimersByTime(LIVE_SESSION_CHECK_MS);
    await flush();
    expect(stream.isCompleted()).toBe(true);
  });

  it('keeps flowing while the session is live, and for other people\'s checks', async () => {
    const stream = open();
    live.recheckSessions('someone-else');
    jest.advanceTimersByTime(LIVE_SESSION_CHECK_MS);
    await flush();
    expect(stream.isCompleted()).toBe(false);
    live.publish('staff-1', 'attendance_status', { status: 'available' });
    expect(stream.received.some((m) => m.type === 'attendance_status')).toBe(true);
  });

  it('closes when the session passes its idle limit or its 2-hour limit', async () => {
    const idle = open();
    session = live_({ lastActivityAt: new Date(Date.now() - 61 * 60 * 1000) });
    live.recheckSessions('staff-1');
    await flush();
    expect(idle.isCompleted()).toBe(true);
    subscription?.unsubscribe();

    const old = open();
    session = live_({ absoluteExpiresAt: new Date(Date.now() - 1000) });
    live.recheckAllSessions();
    await flush();
    expect(old.isCompleted()).toBe(true);
  });

  it('a nudge that arrives while a check is running is not dropped', async () => {
    const stream = open();
    let release: () => void = () => undefined;
    // The first check hangs until released; the session ends meanwhile.
    prisma.staffSession.findUnique.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve(live_()); }) as never,
    );
    live.recheckSessions('staff-1');
    await flush();
    session = live_({ revokedAt: new Date() });
    live.recheckSessions('staff-1');
    release();
    await flush();
    await flush();
    expect(stream.isCompleted()).toBe(true);
  });

  it('a database hiccup does not end the stream; the next check decides', async () => {
    const stream = open();
    failLookup = true;
    jest.advanceTimersByTime(LIVE_SESSION_CHECK_MS);
    await flush();
    expect(stream.isCompleted()).toBe(false);
    failLookup = false;
    session = null; // session row gone
    jest.advanceTimersByTime(LIVE_SESSION_CHECK_MS);
    await flush();
    expect(stream.isCompleted()).toBe(true);
  });
});

describe('Session-ending actions ask open live streams to check at once', () => {
  it('revoking a device asks for a check for that staff member', async () => {
    // Imported here so the controller tests above stay independent of the staff module.
    const { StaffDeviceService } = await import('../../modules/staff/staff-device.service');
    const device = {
      id: 'dev-row-1', staffId: 'staff-1', deviceId: 'device-1', status: 'approved',
      staff: { id: 'staff-1', role: 'call_agent', teamLeadId: null, reportsToId: null },
    };
    const tx = {
      staffDevice: { update: jest.fn(async () => ({ ...device, status: 'revoked' })) },
      staffSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      staffDevice: { findUnique: jest.fn(async () => device) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const live = { recheckSessions: jest.fn() };
    const service = new StaffDeviceService(
      prisma as never,
      { log: jest.fn() } as never,
      {} as never,
      live as never,
    );
    await service.revoke('dev-row-1', { id: 'ceo-1', role: 'ceo' } as never);
    expect(live.recheckSessions).toHaveBeenCalledWith('staff-1');
  });
});

describe('Signing out, revoking a session and a new sign-in ask open streams to check', () => {
  it('logout, session revoke and login nudge the live channel', async () => {
    const { AuthController } = await import('../auth/auth.controller');
    const { StaffSessionController } = await import('../auth/staff-session.controller');
    const live = { recheckSessions: jest.fn(), recheckAllSessions: jest.fn() };
    const auth = {
      logout: jest.fn(async () => ({ success: true })),
      revokeSession: jest.fn(async () => ({ success: true, message: 'ok' })),
      login: jest.fn(async () => ({ accessToken: 't', staff: { id: 'staff-9' } })),
    };
    const authController = new AuthController(auth as never, live as never);
    await authController.logout({ user: { sub: 'staff-1' } } as never);
    expect(live.recheckSessions).toHaveBeenCalledWith('staff-1');
    await authController.login({} as never, { headers: {}, socket: {} } as never);
    expect(live.recheckSessions).toHaveBeenCalledWith('staff-9');
    const sessions = new StaffSessionController(auth as never, live as never);
    await sessions.revokeSession('sess-2', { user: { sub: 'ceo-1' } } as never);
    expect(live.recheckAllSessions).toHaveBeenCalled();
  });
});
