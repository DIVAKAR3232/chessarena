import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { matchRouter } from './modules/matches/match.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { leaderboardRouter, playerRouter } from './modules/players/player.routes.js';
import { getSettings } from './modules/settings/settings.service.js';
import { TIME_CONTROL_PRESETS } from './modules/chess/timeControls.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { coordinatorRouter } from './modules/coordinator/coordinator.routes.js';
import { tournamentRouter } from './modules/tournaments/tournament.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/matches', matchRouter);
apiRouter.use('/players', playerRouter);
apiRouter.use('/leaderboard', leaderboardRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/tournaments', tournamentRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/coordinator', coordinatorRouter);

apiRouter.get('/time-controls', (_req, res) => {
  res.json({ data: TIME_CONTROL_PRESETS });
});

/** Non-secret settings the SPA needs before login (branding, registration availability). */
apiRouter.get('/public-settings', async (_req, res) => {
  const s = await getSettings();
  res.json({
    data: {
      platformName: s.platformName,
      registrationOpen: s.registrationOpen,
      maintenanceMode: s.maintenanceMode,
      maintenanceMessage: s.maintenanceMode ? s.maintenanceMessage : null,
      matchmakingEnabled: s.matchmakingEnabled,
      defaultInitialTimeMs: s.defaultInitialTimeMs,
      defaultIncrementMs: s.defaultIncrementMs,
      customMinInitialMs: s.customMinInitialMs,
      customMaxInitialMs: s.customMaxInitialMs,
      customMaxIncrementMs: s.customMaxIncrementMs,
    },
  });
});
