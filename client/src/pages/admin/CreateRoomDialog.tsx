import { useEffect, useState } from 'react';
import { PlayerPicker } from '../../components/PlayerPicker';
import { Button, Input, Select } from '../../components/ui';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { useAsync } from '../../hooks/useAsync';
import { errorMessage, get, post } from '../../services/api/client';
import type { PublicUser, TimeControlPreset } from '../../types/api';

/**
 * Admin "room": a game between two chosen players. Both are notified; the game starts (and the
 * clocks run) once both players open the board. The admin can watch it live, read-only.
 */
export function CreateRoomDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (matchId: string) => void }) {
  const toast = useToast();
  const presets = useAsync(() => get<TimeControlPreset[]>('/time-controls'), []);
  const [white, setWhite] = useState<PublicUser | null>(null);
  const [black, setBlack] = useState<PublicUser | null>(null);
  const [tc, setTc] = useState('5+3');
  const [rated, setRated] = useState(true);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setWhite(null);
      setBlack(null);
      setWhen('');
    }
  }, [open]);

  const preset = presets.data?.find((p) => p.id === tc);

  return (
    <Dialog open={open} title="Create a game room" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!white || !black || !preset) return;
          setBusy(true);
          try {
            const m = await post<{ id: string }>('/admin/matches', {
              whitePlayerId: white.id,
              blackPlayerId: black.id,
              initialTimeMs: preset.initialTimeMs,
              incrementMs: preset.incrementMs,
              rated,
              ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
            });
            toast.success(`Room created: ${white.displayName} vs ${black.displayName}. Both players were notified.`);
            onCreated(m.id);
            onClose();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PlayerPicker label="White player" value={white} onChange={setWhite} excludeIds={black ? [black.id] : []} />
        <PlayerPicker label="Black player" value={black} onChange={setBlack} excludeIds={white ? [white.id] : []} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Time control" value={tc} onChange={(e) => setTc(e.target.value)} name="room-tc">
            {(presets.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.category})
              </option>
            ))}
          </Select>
          <Select label="Mode" value={rated ? 'rated' : 'casual'} onChange={(e) => setRated(e.target.value === 'rated')} name="room-rated">
            <option value="rated">Rated</option>
            <option value="casual">Casual</option>
          </Select>
        </div>
        <Input label="Start time (optional)" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} name="room-when" hint="Leave empty to let the players start as soon as both open the board." />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!white || !black || !preset}>
            Create room
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
