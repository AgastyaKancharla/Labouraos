import { createContext, useContext, useEffect, useState } from 'react';

/**
 * The current time, injectable for tests (AGENTS.md: time-based logic uses
 * injectable time). Wrap a test in <NowContext.Provider value={() => fixed}>.
 */
export const NowContext = createContext<() => Date>(() => new Date());

/** The current time; re-renders every `refreshMs` when given. */
export function useNow(refreshMs?: number): Date {
  const clock = useContext(NowContext);
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => setNow(clock()), refreshMs);
    return () => clearInterval(id);
  }, [clock, refreshMs]);
  return now;
}

export function useClock(): () => Date {
  return useContext(NowContext);
}
