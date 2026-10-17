import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { CreateRoomDialog } from './CreateRoomDialog';
import { DataTable } from '../../components/tables/DataTable';
import { Badge, Button, Card, ErrorState, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { MatchesTable } from '../../features/matches/MatchesTable';
import { useAsync } from '../../hooks/useAsync';
import { errorMessage, get, getPaged, patch, post } from '../../services/api/client';
import { formatDateTime, humanize, resultToken } from '../../utils/format';

export function AdminMatches() {
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState(0);
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader
        title="Games"
        description="Create game rooms, watch live games read-only, and browse past records with full replays."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Create room</Button>}
      />
      <Card>
        <MatchesTable key={key} endpoint="/admin/matches" showPlayerFilter />
      </Card>
      <CreateRoomDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setKey((k) => k + 1);
          navigate(`/games/${id}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
interface DisputeRow {
  id: string;
  status: string;
  reason: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  originalResult: string | null;
  correctedResult: string | null;
  submittedBy: { username: string; displayName: string };
  resolvedBy: { username: string } | null;
  match: {
    id: string;
    result: string | null;
    status: string;
    terminationReason: string | null;
    whitePlayer: { displayName: string } | null;
    blackPlayer: { displayName: string } | null;
    tournament: { name: string } | null;
  };
}

function ResolveDialog({ dispute, onClose, onDone }: { dispute: DisputeRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [decision, setDecision] = useState('UPHOLD');
  const [corrected, setCorrected] = useState('DRAW');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDecision('UPHOLD');
    setResolution('');
  }, [dispute]);
  if (!dispute) return null;
  return (
    <Dialog open title="Resolve dispute" onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-sm">
          <strong>{dispute.submittedBy.displayName}:</strong> {dispute.reason}
        </p>
        <p className="text-sm">
          Current result: <span className="font-mono">{resultToken(dispute.match.result as never)}</span> ({humanize(dispute.match.terminationReason)})
        </p>
        <Select label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)} name="decision">
          <option value="UPHOLD">Uphold the recorded result</option>
          <option value="REJECT">Reject the dispute</option>
          <option value="CORRECT">Correct the result</option>
        </Select>
        {decision === 'CORRECT' && (
          <Select label="Corrected result" value={corrected} onChange={(e) => setCorrected(e.target.value)} name="corrected">
            <option value="WHITE_WIN">White wins (1–0)</option>
            <option value="BLACK_WIN">Black wins (0–1)</option>
            <option value="DRAW">Draw (½–½)</option>
            <option value="NO_RESULT">No result (void)</option>
          </Select>
        )}
        <div>
          <label htmlFor="resolution" className="mb-1 block text-sm font-medium text-stone-700">
            Resolution notes (recorded in the audit log)
          </label>
          <textarea id="resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={resolution.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/admin/disputes/${dispute.id}/resolve`, { decision, resolution, ...(decision === 'CORRECT' ? { correctedResult: corrected } : {}) });
                toast.success('Dispute resolved');
                onDone();
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Resolve
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function DisputesPage({ endpoint, canResolve }: { endpoint: string; canResolve: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('OPEN');
  const [resolving, setResolving] = useState<DisputeRow | null>(null);
  const list = useAsync(() => getPaged<DisputeRow>(endpoint, { page, pageSize: 20, status: status || undefined }), [page, status, endpoint]);
  return (
    <div>
      <PageHeader title="Result disputes" description="Corrections reverse and re-apply rating changes and are fully audited." />
      <Card>
        <div className="mb-4 max-w-xs">
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} name="status">
            <option value="">All</option>
            {['OPEN', 'UNDER_REVIEW', 'RESOLVED_UPHELD', 'RESOLVED_CORRECTED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(d) => d.id}
          empty="No disputes"
          page={page}
          totalPages={list.data?.meta.totalPages}
          onPage={setPage}
          columns={[
            {
              key: 'match',
              header: 'Match',
              render: (d) => (
                <Link to={`/games/${d.match.id}`} className="hover:underline">
                  {d.match.whitePlayer?.displayName} vs {d.match.blackPlayer?.displayName}
                  {d.match.tournament && <span className="block text-xs text-stone-500">{d.match.tournament.name}</span>}
                </Link>
              ),
            },
            { key: 'by', header: 'Submitted by', render: (d) => d.submittedBy.displayName },
            { key: 'reason', header: 'Reason', render: (d) => <span className="line-clamp-2 max-w-xs text-stone-700">{d.reason}</span> },
            { key: 'status', header: 'Status', render: (d) => <Badge tone={d.status === 'OPEN' ? 'amber' : 'gray'}>{humanize(d.status)}</Badge> },
            { key: 'when', header: 'Submitted', render: (d) => formatDateTime(d.createdAt) },
            {
              key: 'act',
              header: '',
              render: (d) =>
                canResolve && (d.status === 'OPEN' || d.status === 'UNDER_REVIEW') ? (
                  <Button size="sm" onClick={() => setResolving(d)}>
                    Resolve
                  </Button>
                ) : d.resolution ? (
                  <span className="text-xs text-stone-500" title={d.resolution}>
                    by {d.resolvedBy?.username}
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
      <ResolveDialog dispute={resolving} onClose={() => setResolving(null)} onDone={() => void list.reload()} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  createdAt: string;
  actor: { username: string; role: string } | null;
}

export function AdminAudit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [applied, setApplied] = useState({ action: '', resourceType: '' });
  const list = useAsync(
    () => getPaged<AuditRow>('/admin/audit-logs', { page, pageSize: 25, action: applied.action || undefined, resourceType: applied.resourceType || undefined }),
    [page, applied],
  );
  return (
    <div>
      <PageHeader title="Audit log" description="Privileged and security-relevant actions. Secrets are never recorded." />
      <Card>
        <form
          className="mb-4 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied({ action, resourceType });
          }}
        >
          <Input label="Action starts with" placeholder="e.g. admin. or match." value={action} onChange={(e) => setAction(e.target.value)} name="action" />
          <Select label="Resource" value={resourceType} onChange={(e) => setResourceType(e.target.value)} name="resourceType">
            <option value="">Any</option>
            {['user', 'match', 'tournament', 'dispute', 'settings'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <DataTable
          rows={list.data?.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(a) => a.id}
          empty="No entries"
          page={page}
          totalPages={list.data?.meta.totalPages}
          onPage={setPage}
          columns={[
            { key: 'when', header: 'When', render: (a) => <span className="whitespace-nowrap text-stone-600">{formatDateTime(a.createdAt)}</span> },
            { key: 'actor', header: 'Actor', render: (a) => (a.actor ? `${a.actor.username} (${a.actor.role.toLowerCase()})` : 'system') },
            { key: 'action', header: 'Action', render: (a) => <span className="font-mono text-xs">{a.action}</span> },
            { key: 'res', header: 'Resource', render: (a) => <span className="text-xs text-stone-600">{a.resourceType}{a.resourceId ? ` · ${a.resourceId.slice(-8)}` : ''}</span> },
            { key: 'details', header: 'Details', render: (a) => (a.details ? <code className="line-clamp-2 max-w-sm text-xs break-all text-stone-600">{JSON.stringify(a.details)}</code> : null) },
          ]}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
interface Settings {
  platformName: string;
  registrationOpen: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  matchmakingEnabled: boolean;
  defaultInitialTimeMs: number;
  defaultIncrementMs: number;
  customMinInitialMs: number;
  customMaxInitialMs: number;
  customMaxIncrementMs: number;
  maxTournamentParticipants: number;
}

export function AdminSettings() {
  const toast = useToast();
  const s = useAsync(() => get<Settings>('/admin/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data) setForm(s.data);
  }, [s.data]);
  if (s.loading && !form) return <Spinner />;
  if (s.error || !form) return <ErrorState message={s.error ?? 'Failed'} onRetry={s.reload} />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const minutes = (ms: number) => String(ms / 60_000);
  const seconds = (ms: number) => String(ms / 1000);

  return (
    <div className="max-w-2xl">
      <PageHeader title="System settings" description="Non-secret platform configuration. Secrets live only in server environment variables." />
      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const saved = await patch<Settings>('/admin/settings', form);
            setForm(saved);
            toast.success('Settings saved');
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Card title="General">
          <div className="space-y-4">
            <Input label="Platform name" value={form.platformName} onChange={(e) => set('platformName', e.target.value)} name="platformName" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-green-800" checked={form.registrationOpen} onChange={(e) => set('registrationOpen', e.target.checked)} />
              Allow new player registrations
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-green-800" checked={form.matchmakingEnabled} onChange={(e) => set('matchmakingEnabled', e.target.checked)} />
              Enable matchmaking queue
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-green-800" checked={form.maintenanceMode} onChange={(e) => set('maintenanceMode', e.target.checked)} />
              Maintenance mode (only administrators can use the app)
            </label>
            <Input label="Maintenance message" value={form.maintenanceMessage} onChange={(e) => set('maintenanceMessage', e.target.value)} name="maintenanceMessage" />
          </div>
        </Card>
        <Card title="Time controls & limits">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Default base time (minutes)" type="number" min={0.5} step={0.5} value={minutes(form.defaultInitialTimeMs)} onChange={(e) => set('defaultInitialTimeMs', Math.round(Number(e.target.value) * 60_000))} name="defaultInitial" />
            <Input label="Default increment (seconds)" type="number" min={0} value={seconds(form.defaultIncrementMs)} onChange={(e) => set('defaultIncrementMs', Math.round(Number(e.target.value) * 1000))} name="defaultInc" />
            <Input label="Custom min base time (minutes)" type="number" min={0.5} step={0.5} value={minutes(form.customMinInitialMs)} onChange={(e) => set('customMinInitialMs', Math.round(Number(e.target.value) * 60_000))} name="customMin" />
            <Input label="Custom max base time (minutes)" type="number" min={1} value={minutes(form.customMaxInitialMs)} onChange={(e) => set('customMaxInitialMs', Math.round(Number(e.target.value) * 60_000))} name="customMax" />
            <Input label="Custom max increment (seconds)" type="number" min={0} value={seconds(form.customMaxIncrementMs)} onChange={(e) => set('customMaxIncrementMs', Math.round(Number(e.target.value) * 1000))} name="customMaxInc" />
            <Input label="Max tournament participants" type="number" min={2} max={512} value={form.maxTournamentParticipants} onChange={(e) => set('maxTournamentParticipants', Number(e.target.value))} name="maxParticipants" />
          </div>
        </Card>
        <Button type="submit" loading={busy}>
          Save settings
        </Button>
      </form>
    </div>
  );
}
