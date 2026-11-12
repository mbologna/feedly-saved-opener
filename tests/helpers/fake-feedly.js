/**
 * A small in-memory Feedly Cloud: enough of /profile, /streams/:id/ids,
 * /entries/.mget and /markers for the client, sync and jobs to run against.
 */

export const USER_ID = 'user-123';
export const TOKEN = 'token-abc';

/**
 * @param {number} n
 * @param {Object} [overrides]
 * @returns {Object} a Feedly entry with content, like the real API returns
 */
export function makeEntry(n, overrides = {}) {
  return {
    id: `entry-${n}`,
    title: `Article ${n}`,
    canonicalUrl: `https://example.com/article-${n}`,
    alternate: [{ href: `https://example.com/alt-${n}`, type: 'text/html' }],
    origin: { title: `Feed ${n % 3}`, streamId: `feed/https://example.com/feed-${n % 3}` },
    content: { content: '<p>Lots of HTML</p>'.repeat(50) },
    ...overrides
  };
}

/**
 * @param {Object} [options]
 * @param {Array<Object>} [options.entries] - saved entries, newest first
 * @param {number} [options.pageSize] - ids per page, to exercise pagination
 */
export function createFakeFeedly({ entries = [], pageSize = 1000 } = {}) {
  const saved = [...entries];
  const calls = [];
  /** Queue of responses to return before normal handling: Response or Error */
  const failures = [];

  async function fetchImpl(href, init = {}) {
    const url = new URL(href);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: init.headers });

    if (failures.length > 0) {
      const failure = failures.shift();
      if (failure instanceof Error) {
        throw failure;
      }
      return failure;
    }
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) {
      return new Response('{"errorMessage":"token expired"}', { status: 401 });
    }

    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const path = url.pathname.replace(/^\/v3/, '');

    if (path === '/profile') {
      return json({ id: USER_ID, email: 'reader@example.com' });
    }
    if (path === `/streams/${encodeURIComponent(`user/${USER_ID}/tag/global.saved`)}/ids`
      || path === `/streams/user/${USER_ID}/tag/global.saved/ids`) {
      const start = Number(url.searchParams.get('continuation') ?? 0);
      const count = Math.min(Number(url.searchParams.get('count') ?? 20), pageSize);
      const ids = saved.slice(start, start + count).map(entry => entry.id);
      const next = start + count < saved.length ? String(start + count) : undefined;
      return json({ ids, ...(next && { continuation: next }) });
    }
    if (path === '/entries/.mget' && init.method === 'POST') {
      return json(body.map(id => saved.find(entry => entry.id === id)).filter(Boolean));
    }
    if (path === '/markers' && init.method === 'POST') {
      if (body.action === 'markAsUnsaved') {
        for (const id of body.entryIds) {
          const index = saved.findIndex(entry => entry.id === id);
          if (index >= 0) {
            saved.splice(index, 1);
          }
        }
      }
      return new Response('', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }

  return {
    saved,
    calls,
    failures,
    fetch: fetchImpl,
    /** Calls to one endpoint kind: 'ids', 'mget', 'markers', 'profile' */
    callsTo(kind) {
      const match = {
        ids: (call) => call.path.endsWith('/ids'),
        mget: (call) => call.path.endsWith('/entries/.mget'),
        markers: (call) => call.path.endsWith('/markers'),
        profile: (call) => call.path.endsWith('/profile')
      }[kind];
      return calls.filter(match);
    }
  };
}
