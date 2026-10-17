import { Bell } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, cx } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { useAsync } from '../../hooks/useAsync';
import { useSocketEvent } from '../../hooks/useSocket';
import { errorMessage, getPaged, post } from '../../services/api/client';
import type { Notification } from '../../types/api';
import { relativeTime } from '../../utils/format';

export function NotificationsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const list = useAsync(() => getPaged<Notification>('/notifications', { page, pageSize: 20 }), [page]);
  useSocketEvent('notification:new', () => void list.reload());

  async function markAll() {
    try {
      await post('/notifications/read-all');
      await list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={<Button variant="secondary" size="sm" onClick={() => void markAll()}>Mark all as read</Button>} />
      <Card>
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <EmptyState icon={<Bell className="size-6" />} title="You're all caught up" />
        ) : (
          <>
            <ul className="divide-y divide-stone-100">
              {list.data!.data.map((n) => (
                <li key={n.id} className={cx('flex items-start justify-between gap-3 py-3', !n.readAt && 'font-medium')}>
                  <div className="min-w-0">
                    <p className="text-sm text-stone-900">
                      {!n.readAt && <span className="mr-2 inline-block size-2 rounded-full bg-green-700 align-middle" aria-label="Unread" />}
                      {n.title}
                    </p>
                    <p className="text-sm font-normal text-stone-600">{n.message}</p>
                    {n.relatedMatchId && (
                      <Link
                        to={`/games/${n.relatedMatchId}`}
                        onClick={() => void post(`/notifications/${n.id}/read`)}
                        className="text-xs font-normal text-green-800 hover:underline"
                      >
                        Open game
                      </Link>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-normal text-stone-500">{relativeTime(n.createdAt)}</span>
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={list.data!.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
