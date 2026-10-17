import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Card, Input, PageHeader, Select } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { applyServerErrors } from '../../features/auth/applyServerErrors';
import { useAuth } from '../../features/auth/AuthContext';
import { changePasswordSchema } from '../../features/auth/schemas';
import { errorMessage, patch } from '../../services/api/client';
import type { Me } from '../../types/api';
import { formatDateTime } from '../../utils/format';
import { FormError } from '../public/AuthLayout';

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'At least 2 characters').max(64),
  avatar: z.string(),
  profilePublic: z.boolean(),
  notifyByEmail: z.boolean(),
});

const AVATARS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export function AccountPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [pwError, setPwError] = useState<string | null>(null);

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      avatar: user?.avatar ?? '',
      profilePublic: user?.profilePublic ?? true,
      notifyByEmail: user?.notifyByEmail ?? false,
    },
  });
  const pwForm = useForm<z.infer<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });

  if (!user) return null;
  const isPlayer = user.role === 'PLAYER';

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Account settings" description={`Signed in as @${user.username} · ${user.email}`} />

      <Card title="Profile">
        <form
          className="space-y-4"
          onSubmit={profileForm.handleSubmit(async (v) => {
            try {
              const res = await patch<{ user: Me }>('/players/me', {
                displayName: v.displayName,
                avatar: v.avatar || null,
                profilePublic: v.profilePublic,
                notifyByEmail: v.notifyByEmail,
              });
              setUser(res.user);
              toast.success('Profile saved');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          })}
        >
          <Input label="Display name" {...profileForm.register('displayName')} error={profileForm.formState.errors.displayName?.message} />
          <Select label="Avatar" {...profileForm.register('avatar')}>
            <option value="">None</option>
            {AVATARS.map((a) => (
              <option key={a} value={a}>
                {a[0]!.toUpperCase() + a.slice(1)}
              </option>
            ))}
          </Select>
          {isPlayer && (
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" className="size-4 accent-green-800" {...profileForm.register('profilePublic')} />
              Show my profile on the public leaderboard
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" className="size-4 accent-green-800" {...profileForm.register('notifyByEmail')} />
            Email me about invitations and results (when email is configured)
          </label>
          <Button type="submit" loading={profileForm.formState.isSubmitting}>
            Save profile
          </Button>
        </form>
      </Card>

      <Card title="Change password">
        <form
          className="space-y-4"
          noValidate
          onSubmit={pwForm.handleSubmit(async (v) => {
            setPwError(null);
            try {
              await patch('/players/me/password', v);
              pwForm.reset();
              toast.success('Password changed. Other devices were signed out.');
            } catch (err) {
              setPwError(applyServerErrors(err, pwForm.setError, ['currentPassword', 'newPassword', 'confirmPassword']));
            }
          })}
        >
          <FormError message={pwError} />
          <Input label="Current password" type="password" autoComplete="current-password" {...pwForm.register('currentPassword')} error={pwForm.formState.errors.currentPassword?.message} />
          <Input label="New password" type="password" autoComplete="new-password" {...pwForm.register('newPassword')} error={pwForm.formState.errors.newPassword?.message} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" {...pwForm.register('confirmPassword')} error={pwForm.formState.errors.confirmPassword?.message} />
          <Button type="submit" loading={pwForm.formState.isSubmitting}>
            Change password
          </Button>
        </form>
      </Card>

      <Card title="Account">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-stone-500">Role</dt>
          <dd className="capitalize">{user.role.toLowerCase()}</dd>
          <dt className="text-stone-500">Member since</dt>
          <dd>{formatDateTime(user.createdAt)}</dd>
          <dt className="text-stone-500">Last sign-in</dt>
          <dd>{formatDateTime(user.lastLoginAt)}</dd>
        </dl>
      </Card>
    </div>
  );
}
