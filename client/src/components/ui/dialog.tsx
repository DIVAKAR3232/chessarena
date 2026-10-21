import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './index';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-stone-200 p-0 shadow-xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        <div className="mt-3 text-sm text-stone-700">{children}</div>
      </div>
      {footer && <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50 px-5 py-3">{footer}</div>}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  /** When set, the user must type a reason (min 3 chars) which is passed to onConfirm. */
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', requireReason, onConfirm, onClose }: ConfirmProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const invalid = requireReason && reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
      {requireReason && (
        <div className="mt-3">
          <label htmlFor="confirm-reason" className="mb-1 block text-sm font-medium text-stone-700">
            Reason
          </label>
          <textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-green-700 focus:ring-2 focus:ring-green-100"
          />
        </div>
      )}
    </Dialog>
  );
}
