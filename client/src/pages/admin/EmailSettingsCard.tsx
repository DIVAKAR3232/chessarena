import { Mail, Send } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Input, Spinner } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { useAsync } from '../../hooks/useAsync';
import { errorMessage, get, post } from '../../services/api/client';

interface EmailStatus {
  provider: 'brevo' | 'smtp' | 'none';
  configured: boolean;
  from: string;
  smtpHost: string | null;
  verificationRequired: boolean;
}

const PROVIDER_LABEL: Record<EmailStatus['provider'], string> = {
  brevo: 'Brevo (HTTPS API)',
  smtp: 'SMTP',
  none: 'Not configured',
};

/** Shows which email provider the server uses and lets the admin send a test message. */
export function EmailSettingsCard() {
  const toast = useToast();
  const status = useAsync(() => get<EmailStatus>('/admin/email/status'), []);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <Card title={<span className="flex items-center gap-2"><Mail className="size-4" /> Email (password resets)</span>}>
      {status.loading && !status.data ? (
        <Spinner />
      ) : !status.data ? (
        <p className="text-sm text-red-700">{status.error}</p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-stone-500">Provider</dt>
            <dd>
              <Badge tone={status.data.configured ? 'green' : 'red'}>{PROVIDER_LABEL[status.data.provider]}</Badge>
              {status.data.smtpHost && <span className="ml-2 text-stone-500">{status.data.smtpHost}</span>}
            </dd>
            <dt className="text-stone-500">Sender</dt>
            <dd className="break-all">{status.data.from}</dd>
            <dt className="text-stone-500">Verification</dt>
            <dd>{status.data.verificationRequired ? 'New players must verify their email' : 'Not required'}</dd>
          </dl>
          {!status.data.configured && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Reset emails are not being sent. Add the email settings to the server environment (see docs/DEPLOYMENT.md,
              section "Password-reset emails"), then restart the server.
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setLastResult(null);
              try {
                const r = await post<{ provider: string }>('/admin/email/test', { to });
                setLastResult({ ok: true, message: `Test email accepted by ${r.provider}. Check the inbox (and spam folder) of ${to}.` });
                toast.success('Test email sent');
              } catch (err) {
                setLastResult({ ok: false, message: errorMessage(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input className="min-w-56 flex-1" label="Send a test email to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} name="test-to" />
            <Button type="submit" variant="secondary" icon={<Send className="size-4" />} loading={busy} disabled={!status.data.configured}>
              Send test
            </Button>
          </form>
          {lastResult && (
            <p role="status" className={lastResult.ok ? 'text-sm text-green-800' : 'text-sm text-red-700'}>
              {lastResult.message}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
