import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, StatCard } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import { useAsync } from '../../hooks/useAsync';
import { del, errorMessage, get, patch, post } from '../../services/api/client';
import type { MatchListItem, Me, PlayerStats, Role } from '../../types/api';
import { formatDateTime, relativeTime } from '../../utils/format';
import { statusTone } from './AdminUsers';

interface Detail {
  user: Me;
  stats: PlayerStats | null;
  recentMatches: MatchListItem[];
  activeSessions: number;
  audits: { id: string; action: string; createdAt: string; actor: { username: string } | null }[];
}

type Pending = { kind: 'role'; role: Role } | { kind: 'status'; status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' } | { kind: 'reset' } | { kind: 'remove' } | null;

export function AdminUserDetail() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const d = useAsync(() => get<Detail>(`/admin/users/${id}`), [id]);
  const [pending, setPending] = useState<Pending>(null);
  const [roleChoice, setRoleChoice] = useState<Role | ''>('');

  if (d.loading && !d.data) return <Spinner />;
  if (d.error || !d.data) return <ErrorState message={d.error ?? 'Not found'} onRetry={d.reload} />;
  const { user, stats } = d.data;
  const self = me?.id === user.id;

  async function run(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      await d.reload();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={user.displayName}
        description={`@${user.username} · ${user.email}`}
        actions={
          <>
            <Badge tone={user.role === 'ADMIN' ? 'red' : user.role === 'COORDINATOR' ? 'blue' : 'gray'}>{user.role.toLowerCase()}</Badge>
            <Badge tone={statusTone(user.accountStatus)}>{user.accountStatus.toLowerCase()}</Badge>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Created" value={<span className="text-base">{formatDateTime(user.createdAt)}</span>} />
        <StatCard label="Last sign-in" value={<span className="text-base">{formatDateTime(user.lastLoginAt)}</span>} />
        <StatCard label="Active sessions" value={d.data.activeSessions} />
        {stats && <StatCard label="Rating · W/D/L" value={`${user.profile?.rating ?? '—'}`} hint={`${stats.wins}/${stats.draws}/${stats.losses} in ${stats.games} games`} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account actions">
          {self ? (
            <p className="text-sm text-stone-600">You cannot change your own role or status. Ask another administrator.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-end gap-2">
                <Select label="Change role" value={roleChoice} onChange={(e) => setRoleChoice(e.target.value as Role)} className="flex-1" name="role">
                  <option value="">Select a role…</option>
                  {(['PLAYER', 'COORDINATOR', 'ADMIN'] as const)
                    .filter((r) => r !== user.role)
                    .map((r) => (
                      <option key={r} value={r}>
                        {r.toLowerCase()}
                      </option>
                    ))}
                </Select>
                <Button variant="secondary" disabled={!roleChoice} onClick={() => roleChoice && setPending({ kind: 'role', role: roleChoice })}>
                  Apply
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {user.accountStatus !== 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => setPending({ kind: 'status', status: 'ACTIVE' })}>
                    Reactivate
                  </Button>
                )}
                {user.accountStatus !== 'SUSPENDED' && (
                  <Button variant="secondary" onClick={() => setPending({ kind: 'status', status: 'SUSPENDED' })}>
                    Suspend
                  </Button>
                )}
                {user.accountStatus !== 'DISABLED' && (
                  <Button variant="danger" onClick={() => setPending({ kind: 'status', status: 'DISABLED' })}>
                    Disable
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setPending({ kind: 'reset' })}>
                  Send password reset
                </Button>
                <Button variant="danger" onClick={() => setPending({ kind: 'remove' })}>
                  Remove user
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Recent audit entries">
          {d.data.audits.length === 0 ? (
            <EmptyState title="No entries" />
          ) : (
            <ul className="max-h-64 divide-y divide-stone-100 overflow-y-auto text-sm">
              {d.data.audits.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-1.5">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-stone-500">
                    {a.actor?.username ?? 'system'} · {relativeTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent matches">
        {d.data.recentMatches.length === 0 ? (
          <EmptyState title="No matches" />
        ) : (
          <div className="-mx-3">
            {d.data.recentMatches.map((m) => (
              <MatchRow key={m.id} m={m} viewerId={user.id} />
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pending?.kind === 'role'}
        title="Change role?"
        message={pending?.kind === 'role' ? `${user.displayName} will become ${pending.role.toLowerCase()}. Their sessions will be signed out.` : ''}
        onClose={() => setPending(null)}
        onConfirm={() => (pending?.kind === 'role' ? run(() => patch(`/admin/users/${id}/role`, { role: pending.role }), 'Role updated') : undefined)}
      />
      <ConfirmDialog
        open={pending?.kind === 'status'}
        title={pending?.kind === 'status' ? `${pending.status === 'ACTIVE' ? 'Reactivate' : pending.status === 'SUSPENDED' ? 'Suspend' : 'Disable'} account?` : ''}
        message={pending?.kind === 'status' && pending.status !== 'ACTIVE' ? 'The user is signed out everywhere immediately.' : 'The user will be able to sign in again.'}
        tone={pending?.kind === 'status' && pending.status !== 'ACTIVE' ? 'danger' : 'primary'}
        requireReason
        onClose={() => setPending(null)}
        onConfirm={(reason) => (pending?.kind === 'status' ? run(() => patch(`/admin/users/${id}/status`, { status: pending.status, reason }), 'Status updated') : undefined)}
      />
      <ConfirmDialog
        open={pending?.kind === 'remove'}
        title={`Remove ${user.displayName}?`}
        message={
          <>
            <p>The account is signed out everywhere and can no longer be used.</p>
            <p className="mt-2 text-stone-600">
              If this user has never played or organized anything, the account is deleted permanently. If they have game
              history, the account is deactivated and hidden from the leaderboard instead, so their opponents' records and
              ratings stay correct.
            </p>
          </>
        }
        confirmLabel="Remove user"
        tone="danger"
        requireReason
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          try {
            const r = await del<{ mode: 'deleted' | 'deactivated'; username: string }>(`/admin/users/${id}`, { reason });
            toast.success(r.mode === 'deleted' ? `${r.username} was deleted` : `${r.username} was deactivated (game history kept)`);
            navigate('/admin/users');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title="Send password reset?"
        message={`A single-use reset link (valid 30 minutes) will be emailed to ${user.email}. Administrators never see passwords.`}
        onClose={() => setPending(null)}
        onConfirm={() => run(() => post(`/admin/users/${id}/password-reset`), 'Reset link sent')}
      />
    </div>
  );
}
