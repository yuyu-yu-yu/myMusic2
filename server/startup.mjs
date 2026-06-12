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
