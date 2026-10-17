import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { DataTable } from '../../components/tables/DataTable';
import { Badge, Button, Card, Input, PageHeader, Select } from '../../components/ui';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { applyServerErrors } from '../../features/auth/applyServerErrors';
import { registerSchema } from '../../features/auth/schemas';
import { useAsync } from '../../hooks/useAsync';
import { getPaged, post } from '../../services/api/client';
import type { Me } from '../../types/api';
import { formatDateTime } from '../../utils/format';
import { FormError } from '../public/AuthLayout';

const coordinatorSchema = registerSchema;

function AddUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [role, setRole] = useState<'PLAYER' | 'COORDINATOR' | 'ADMIN'>('PLAYER');
  const { register, handleSubmit, formState, setError, reset } = useForm<z.infer<typeof coordinatorSchema>>({ resolver: zodResolver(coordinatorSchema) });
  useEffect(() => {
    if (open) {
      reset();
      setRole('PLAYER');
      setFormError(null);
    }
  }, [open, reset]);
  return (
    <Dialog open={open} title="Add a user" onClose={onClose}>
      <form
        className="space-y-3"
        noValidate
        onSubmit={handleSubmit(async ({ confirmPassword: _c, ...v }) => {
          try {
            await post('/admin/users', { ...v, role });
            toast.success(`${role.toLowerCase()} ${v.username} created`);
            onCreated();
            onClose();
          } catch (err) {
            setFormError(applyServerErrors(err, setError, ['displayName', 'username', 'email', 'password']));
          }
        })}
      >
        <FormError message={formError} />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} name="new-role">
          <option value="PLAYER">Player</option>
          <option value="COORDINATOR">Coordinator</option>
          <option value="ADMIN">Administrator</option>
        </Select>
        <Input label="Display name" {...register('displayName')} error={formState.errors.displayName?.message} />
        <Input label="Username" {...register('username')} error={formState.errors.username?.message} />
        <Input label="Email" type="email" {...register('email')} error={formState.errors.email?.message} />
        <Input label="Initial password" type="password" autoComplete="new-password" hint="Share it securely; the user should change it after signing in." {...register('password')} error={formState.errors.password?.message} />
        <Input label="Confirm password" type="password" autoComplete="new-password" {...register('confirmPassword')} error={formState.errors.confirmPassword?.message} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export const statusTone = (s: string) => (s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'amber' : 'red') as 'green' | 'amber' | 'red';

export function AdminUsers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useAsync(
    () => getPaged<Me>('/admin/users', { page, pageSize: 20, search: debounced || undefined, role: role || undefined, status: status || undefined, sort }),
    [page, debounced, role, status, sort],
  );

  return (
    <div>
      <PageHeader title="Users" description="Search, filter and manage every account." actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Add user</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Input label="Search" placeholder="Username, email or name" value={search} onChange={(e) => setSearch(e.target.value)} name="search" />
          <Select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} name="role">
            <option value="">All roles</option>
            <option value="PLAYER">Player</option>
            <option value="COORDINATOR">Coordinator</option>
            <option value="ADMIN">Admin</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} name="status">
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DISABLED">Disabled</option>
          </Select>
          <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} name="sort">
            <option value="createdAt">Newest</option>
            <option value="lastLoginAt">Last sign-in</option>
            <option value="username">Username</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(u) => u.id}
          empty="No users match these filters"
          page={page}
          totalPages={list.data?.meta.totalPages}
          onPage={setPage}
          columns={[
            {
              key: 'user',
              header: 'User',
              render: (u) => (
                <Link to={`/admin/users/${u.id}`} className="hover:underline">
                  <span className="font-medium text-stone-900">{u.displayName}</span> <span className="text-stone-500">@{u.username}</span>
                </Link>
              ),
            },
            { key: 'email', header: 'Email', render: (u) => <span className="text-stone-600">{u.email}</span> },
            { key: 'role', header: 'Role', render: (u) => <Badge tone={u.role === 'ADMIN' ? 'red' : u.role === 'COORDINATOR' ? 'blue' : 'gray'}>{u.role.toLowerCase()}</Badge> },
            { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.accountStatus)}>{u.accountStatus.toLowerCase()}</Badge> },
            { key: 'rating', header: 'Rating', className: 'text-right tabular-nums', render: (u) => u.profile?.rating ?? '—' },
            { key: 'created', header: 'Created', render: (u) => <span className="text-stone-600">{formatDateTime(u.createdAt)}</span> },
            { key: 'login', header: 'Last sign-in', render: (u) => <span className="text-stone-600">{formatDateTime(u.lastLoginAt)}</span> },
          ]}
        />
      </Card>
      <AddUserDialog open={creating} onClose={() => setCreating(false)} onCreated={() => void list.reload()} />
    </div>
  );
}
