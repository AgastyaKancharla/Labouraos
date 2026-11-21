import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api/client';
import { formatTimeIST } from '../lib/format/date';

interface Row {
  id: string;
  title: string;
  body: string | null;
  at: string;
}

/**
 * "Signed in again without a code" (21 Nov hardening): someone in the team
 * signed in again on a device that had a login code earlier today, and it
 * ended a session still in use or came from a new network. Shown on the Login
 * codes screen of the Team Lead and the Manager above (and the CEO for his
 * people), from today's bells addressed to the reader.
 */
export function NoCodeSignIns() {
  const rows = useQuery({
    queryKey: ['login-codes', 'without-code'],
    queryFn: () => api.get<Row[]>('/login-codes/without-code'),
    refetchInterval: 60_000,
  });
  if (!rows.data?.length) return null;
  return (
    <Card title="Signed in again without a code today" aria-label="Signed in again without a code today">
      <ul className="lb-list" style={{ margin: 0, paddingLeft: 18 }}>
        {rows.data.map((row) => (
          <li key={row.id}>
            <strong>{formatTimeIST(row.at)}</strong> · {row.title}
            {row.body ? <div className="tl-sub">{row.body}</div> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
