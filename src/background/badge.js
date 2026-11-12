/**
 * Toolbar badge, derived from storage: the saved count, a different colour
 * while a job is opening tabs, and "!" when Feedly rejects the token.
 */

import { badgeText } from '../shared/core.js';
import { ACTIVE_STATUSES } from './jobs.js';

export const BADGE_COLORS = Object.freeze({
  normal: '#667eea',
  busy: '#10b981',
  error: '#dc3545'
});

/**
 * @param {Object} action - `browser.action`
 * @param {{token?: string, authError?: boolean, count: number, job?: Object|null}} state
 */
export async function renderBadge(action, { token, authError, count, job }) {
  if (!token) {
    await action.setBadgeText({ text: '' });
    return;
  }
  if (authError) {
    await action.setBadgeText({ text: '!' });
    await action.setBadgeBackgroundColor({ color: BADGE_COLORS.error });
    return;
  }
  const busy = Boolean(job && ACTIVE_STATUSES.has(job.status));
  await action.setBadgeText({ text: badgeText(count) });
  await action.setBadgeBackgroundColor({ color: busy ? BADGE_COLORS.busy : BADGE_COLORS.normal });
}
