import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BADGE_COLORS, renderBadge } from '../src/background/badge.js';
import { createFakeBrowser } from './helpers/fake-browser.js';

describe('renderBadge', () => {
  const render = async (state) => {
    const { action } = createFakeBrowser();
    await renderBadge(action, { count: 0, ...state });
    return action.badge;
  };

  it('is empty when not connected', async () => {
    assert.equal((await render({ count: 5 })).text, '');
  });

  it('shows "!" in red when the token is rejected', async () => {
    assert.deepEqual(await render({ token: 't', authError: true, count: 5 }), { text: '!', color: BADGE_COLORS.error });
  });

  it('shows the count, green while a job runs', async () => {
    assert.deepEqual(await render({ token: 't', count: 42 }), { text: '42', color: BADGE_COLORS.normal });
    assert.deepEqual(await render({ token: 't', count: 1200, job: { status: 'running' } }), { text: '999+', color: BADGE_COLORS.busy });
    assert.equal((await render({ token: 't', count: 3, job: { status: 'done' } })).color, BADGE_COLORS.normal);
    assert.equal((await render({ token: 't', count: 0 })).text, '');
  });
});
