import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSocketEvent } from '../../hooks/useSocket';
import { get } from '../../services/api/client';
import type { Notification } from '../../types/api';
import { useToast } from '../ui/toast';

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const toast = useToast();

  useEffect(() => {
    get<{ count: number }>('/notifications/unread-count')
      .then((r) => setCount(r.count))
      .catch(() => undefined);
  }, []);

  useSocketEvent<Notification>('notification:new', (n) => {
    setCount((c) => c + 1);
    toast.info(`${n.title} — ${n.message}`);
  });
  useSocketEvent('notifications:read', () => setCount(0));

  return (
    <Link
      to="/notifications"
      className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}
      onClick={() => setCount(0)}
    >
      <Bell className="size-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-green-700 px-1 text-[10px] font-semibold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
