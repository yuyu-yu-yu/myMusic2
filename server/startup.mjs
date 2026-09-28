import { seedDemoLibrary } from './db.mjs';

export function initializeDemoRuntime({
  db,
  config = {},
  cookieStatus = {},
  startLibrarySync,
  schedule = queueMicrotask,
  logger = console
} = {}) {
  if (!db) throw new Error('initializeDemoRuntime requires a database');

  seedDemoLibrary(db);

  const syncScheduled = Boolean(
    config.demo?.guestMode
    && cookieStatus.hasCookie
    && typeof startLibrarySync === 'function'
  );

  if (syncScheduled) {
    schedule(() => {
      try {
        Promise.resolve(startLibrarySync()).catch((error) => {
          logger.warn('[startup] shared library sync failed; keeping demo library:', error?.message || error);
        });
      } catch (error) {
        logger.warn('[startup] shared library sync failed; keeping demo library:', error?.message || error);
      }
    });
  }

  return { demoSeeded: true, syncScheduled };
}

export const LIBRARY_SYNCING_CODE = 'library_syncing';

// In guest mode the shared library is rebuilt after every deploy; while that sync runs,
// radio routes would otherwise fall back to the 3 placeholder demo tracks.
export function sharedLibrarySyncGuard({ config = {}, syncStatus = {}, method = '', pathname = '' } = {}) {
  if (!config.demo?.guestMode) return null;
  if (syncStatus.status !== 'running') return null;
  if (method !== 'POST' || !String(pathname).startsWith('/api/radio/')) return null;
  return {
    __error: true,
    ok: false,
    status: 503,
    code: LIBRARY_SYNCING_CODE,
    error: '共享曲库正在同步（大约 1 分钟），同步完成后就能开播，请稍后再点一次。',
    syncProgress: {
      phase: syncStatus.phase || '',
      currentPlaylistIndex: syncStatus.currentPlaylistIndex || 0,
      totalPlaylists: syncStatus.totalPlaylists || 0
    }
  };
}
