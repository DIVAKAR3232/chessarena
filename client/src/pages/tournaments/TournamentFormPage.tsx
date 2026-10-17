import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Input, PageHeader, Select } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { useAsync } from '../../hooks/useAsync';
import { ApiError, getPaged, post } from '../../services/api/client';
import type { Me } from '../../types/api';
import { FormError } from '../public/AuthLayout';

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function TournamentFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const coordinators = useAsync(() => getPaged<Me>('/admin/users', { role: 'COORDINATOR', status: 'ACTIVE', pageSize: 100 }), []);
  const [f, setF] = useState({
    name: '',
    description: '',
    format: 'ROUND_ROBIN',
    baseMinutes: '5',
    incrementSeconds: '3',
    rated: true,
    maxParticipants: '8',
    minParticipants: '2',
    registrationOpensAt: '',
    registrationClosesAt: '',
    startsAt: '',
    endsAt: '',
    coordinatorIds: [] as string[],
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="max-w-3xl">
      <PageHeader title="New tournament" description="Created as a draft. Publish it when the details are final." />
      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const t = await post<{ id: string }>('/tournaments', {
              name: f.name,
              description: f.description,
              format: f.format,
              initialTimeMs: Math.round(Number(f.baseMinutes) * 60_000),
              incrementMs: Math.round(Number(f.incrementSeconds) * 1000),
              rated: f.rated,
              maxParticipants: Number(f.maxParticipants),
              minParticipants: Number(f.minParticipants),
              registrationOpensAt: toIso(f.registrationOpensAt),
              registrationClosesAt: toIso(f.registrationClosesAt),
              startsAt: toIso(f.startsAt),
              endsAt: toIso(f.endsAt),
              coordinatorIds: f.coordinatorIds,
            });
            toast.success('Tournament created');
            navigate(`/admin/tournaments/${t.id}`);
          } catch (err) {
            setError(err instanceof ApiError ? [err.message, ...err.fieldIssues.map((i) => `${i.path}: ${i.message}`)].join(' · ') : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError message={error} />
        <Card title="Details">
          <div className="space-y-4">
            <Input label="Name" required minLength={3} value={f.name} onChange={(e) => set('name', e.target.value)} name="name" />
            <div>
              <label htmlFor="description" className="mb-1 block text-sm font-medium text-stone-700">
                Description
              </label>
              <textarea id="description" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Format" value={f.format} onChange={(e) => set('format', e.target.value)} name="format">
                <option value="ROUND_ROBIN">Round robin</option>
                <option value="SINGLE_ELIMINATION">Single elimination</option>
              </Select>
              <Input label="Base time (minutes)" type="number" min={0.5} step={0.5} value={f.baseMinutes} onChange={(e) => set('baseMinutes', e.target.value)} name="base" />
              <Input label="Increment (seconds)" type="number" min={0} value={f.incrementSeconds} onChange={(e) => set('incrementSeconds', e.target.value)} name="inc" />
              <Input label="Max players" type="number" min={2} value={f.maxParticipants} onChange={(e) => set('maxParticipants', e.target.value)} name="max" />
              <Input label="Min players" type="number" min={2} value={f.minParticipants} onChange={(e) => set('minParticipants', e.target.value)} name="min" />
              <Select label="Mode" value={f.rated ? 'rated' : 'casual'} onChange={(e) => set('rated', e.target.value === 'rated')} name="rated">
                <option value="rated">Rated</option>
                <option value="casual">Casual</option>
              </Select>
            </div>
          </div>
        </Card>
        <Card title="Schedule (optional)">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Registration opens" type="datetime-local" value={f.registrationOpensAt} onChange={(e) => set('registrationOpensAt', e.target.value)} name="ro" />
            <Input label="Registration closes" type="datetime-local" value={f.registrationClosesAt} onChange={(e) => set('registrationClosesAt', e.target.value)} name="rc" />
            <Input label="Starts" type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} name="starts" />
            <Input label="Ends" type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} name="ends" />
          </div>
        </Card>
        <Card title="Coordinators">
          {(coordinators.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-stone-500">No coordinator accounts yet. Create one under Users.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {coordinators.data!.data.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-green-800"
                    checked={f.coordinatorIds.includes(c.id)}
                    onChange={(e) => set('coordinatorIds', e.target.checked ? [...f.coordinatorIds, c.id] : f.coordinatorIds.filter((x) => x !== c.id))}
                  />
                  {c.displayName} <span className="text-stone-500">@{c.username}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
        <Button type="submit" loading={busy}>
          Create tournament
        </Button>
      </form>
    </div>
  );
}
