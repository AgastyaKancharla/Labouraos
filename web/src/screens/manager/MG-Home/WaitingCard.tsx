import { useMemo } from 'react';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { RequestActions, RequestWants, RequestWho, treeIndex, useTree, useWaiting, waitedFor } from '../_kit/requests';

/** How many requests the Home card lists before "All requests". */
export const HOME_WAITING_ROWS = 5;

/**
 * MG-Home "Waiting for you": the oldest requests waiting for the Manager
 * (GET /requests/waiting), each with Approve · Reject · Open.
 */
export function WaitingCard() {
  const to = useScreenPath();
  const now = useNow();
  const waiting = useWaiting();
  const staff = useTree();
  const tree = useMemo(() => treeIndex(staff.data), [staff.data]);
  const rows = waiting.data ?? [];
  return (
    <Card title="Waiting for you" aside={<ButtonLink to={to('MG-Requests')}>{`All requests${waiting.data ? ` (${rows.length})` : ''}`}</ButtonLink>}>
      {waiting.error ? (
        <ErrorState error={waiting.error} onRetry={() => void waiting.refetch()} />
      ) : (
        <div className="scrollx">
          <table>
            <caption className="sr-only">Requests waiting for you</caption>
            <thead>
              <tr>
                <th>Who</th>
                <th>Wants</th>
                <th>Waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {waiting.isPending && (
                <tr>
                  <td colSpan={4}>
                    <span className="lb-skeleton" style={{ height: 18, width: '40%', display: 'block' }} aria-hidden="true" />
                  </td>
                </tr>
              )}
              {rows.slice(0, HOME_WAITING_ROWS).map((r) => (
                <tr key={r.ref}>
                  <td>
                    <RequestWho request={r} tree={tree} />
                  </td>
                  <td>
                    <RequestWants request={r} />
                  </td>
                  <td>{waitedFor(r.createdAt, now)}</td>
                  <td>
                    <RequestActions request={r} tree={tree} />
                  </td>
                </tr>
              ))}
              {waiting.data && !rows.length && (
                <tr>
                  <td colSpan={4}>Nothing is waiting for you.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="mg-note">Agents' leave goes to their Team Lead first · it comes to you only if forwarded or not answered in 24 hours</div>
    </Card>
  );
}
