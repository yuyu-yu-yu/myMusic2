import {
  clearUserMemories,
  deleteAccountSettings,
  deleteUserMemory,
  getAccountSetting,
  getFeedbackSummaryMap,
  listRecentPlays,
  listUserMemories,
  recordOrMergeUserMemory,
  recordTrackFeedback,
  retrieveRelevantMemories,
  setAccountSetting
} from './db.mjs';
import { normalizeAccountContext } from './account-scope.mjs';

export function createPersonalizationStore(db, accountContext) {
  const context = normalizeAccountContext(accountContext);
  const accountId = context.accountId;

  return {
    accountContext: context,
    accountId,
    getSetting: (key) => getAccountSetting(db, accountId, key),
    setSetting: (key, value) => setAccountSetting(db, accountId, key, value),
    deleteSettings: (keys) => deleteAccountSettings(db, accountId, keys),
    listMemories: (limit = 200) => listUserMemories(db, { accountId, limit }),
    retrieveMemories: (options = {}) => retrieveRelevantMemories(db, { ...options, accountId }),
    recordMemory: (memory = {}) => recordOrMergeUserMemory(db, { ...memory, accountId }),
    deleteMemory: (id) => deleteUserMemory(db, id, accountId),
    clearMemories: () => clearUserMemories(db, accountId),
    recordFeedback: (payload = {}) => recordTrackFeedback(db, { ...payload, accountId }),
    feedbackMap: (trackIds = []) => getFeedbackSummaryMap(db, trackIds, accountId),
    recentPlays: (limit = 30) => listRecentPlays(db, limit, accountId)
  };
}
