import { assertKnownProcessRole, processRole, runsJobs, servesWeb, startupRoleMessage } from './process-role';

describe('PROCESS_ROLE', () => {
  it('reads web (default), worker and all; anything else is web', () => {
    expect(processRole({})).toBe('web');
    expect(processRole({ PROCESS_ROLE: 'web' })).toBe('web');
    expect(processRole({ PROCESS_ROLE: 'worker' })).toBe('worker');
    expect(processRole({ PROCESS_ROLE: ' ALL ' })).toBe('all');
    expect(processRole({ PROCESS_ROLE: 'both' })).toBe('web');
  });

  it('all runs the jobs and serves the web; worker only runs jobs; web only serves', () => {
    expect([runsJobs({ PROCESS_ROLE: 'all' }), servesWeb({ PROCESS_ROLE: 'all' })]).toEqual([true, true]);
    expect([runsJobs({ PROCESS_ROLE: 'worker' }), servesWeb({ PROCESS_ROLE: 'worker' })]).toEqual([true, false]);
    expect([runsJobs({ PROCESS_ROLE: 'web' }), servesWeb({ PROCESS_ROLE: 'web' })]).toEqual([false, true]);
    expect([runsJobs({}), servesWeb({})]).toEqual([false, true]);
  });
});

describe('PROCESS_ROLE start-up check', () => {
  it('refuses a misspelt role instead of silently running no job', () => {
    expect(() => assertKnownProcessRole({ PROCESS_ROLE: 'both' })).toThrow(/not one of web, worker or all/);
    expect(assertKnownProcessRole({ PROCESS_ROLE: 'all' })).toBe('all');
    expect(assertKnownProcessRole({})).toBe('web');
  });

  it('logs what the process does', () => {
    expect(startupRoleMessage('all')).toBe('PROCESS_ROLE=all: serving the API and running every scheduled job');
  });
});
