import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * get_post post-reference resolution — real-handler regression tests.
 *
 * Intent (Task 1): lock in the exact observable behavior of the *real*
 * `get_post` callback registered by `registerTools`, driven through mocked
 * `node-fetch`. These two cases are intentionally RED against the unmodified
 * handler and must stay committed as the failing spec until the handler-side
 * fix (later tasks) lands.
 *
 * Historical failing arguments (from the bug report): a Reddit share-link
 * reference was passed as the post id, i.e. postId carried the `s/<token>`
 * share segment. The unmodified handler concatenates postId after `/comments/`
 * and therefore requests
 *   /r/webscraping/comments/s/yf4R7bbaHP   (a 200 page with no post identity)
 * instead of the share route
 *   /r/webscraping/s/yf4R7bbaHP            (canonicalizes to the real post).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// src/tools.ts reads REDLIB_URL at module-evaluation time; pin it before the
// dynamic import so the requested-route assertions are deterministic.
const REDLIB_BASE = 'http://redlib.test:8080';
process.env.REDLIB_URL = REDLIB_BASE;

const HISTORICAL_ARGS = { subreddit: 'webscraping', postId: 's/yf4R7bbaHP' };

const SHARE_PATH = '/r/webscraping/s/yf4R7bbaHP';
const CANONICAL_PATH = '/r/webscraping/comments/1x7hpcl/example_share_post/';
// Exactly what the unmodified handler builds for the historical arguments.
const WRONG_PATH = '/r/webscraping/comments/s/yf4R7bbaHP';

const SHARE_URL = `${REDLIB_BASE}${SHARE_PATH}`;
const CANONICAL_URL = `${REDLIB_BASE}${CANONICAL_PATH}`;
const WRONG_URL = `${REDLIB_BASE}${WRONG_PATH}`;

// SYNTHETIC fixture: derived from the saved live fixture tests/fixtures/
// post-detail.html by swapping the post-id token only (t93ec3 -> 1x7hpcl).
// This is NOT a captured live response for post 1x7hpcl.
const VALID_POST_HTML = readFileSync(join(__dirname, 'fixtures', 'post-detail.html'), 'utf-8')
  .replaceAll('t93ec3', '1x7hpcl');

// HTTP-200 page carrying no parseable post identity (redlib's empty/error
// page). Served for the broken comments/<share-ref> route and as the
// companion empty-page case.
const EMPTY_PAGE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Redlib</title></head><body><main></main></body></html>';

interface UpstreamRoute {
  status: number;
  body?: string;
  location?: string;
}

// Route table keyed by absolute request URL; '*' is a catch-all.
let upstream: Record<string, UpstreamRoute> = {};
let requestedUrls: string[] = [];

function makeResponse(status: number, body: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    async text(): Promise<string> {
      return body;
    },
  };
}

async function fetchMock(input: unknown, init: any = {}) {
  let url = String(input);
  // Emulate node-fetch's default redirect following: a real redlib share route
  // 302s to the canonical /comments/ URL, which then serves the post HTML.
  for (let hop = 0; hop < 5; hop++) {
    requestedUrls.push(url);
    const route = upstream[url] ?? upstream['*'];
    if (!route) return makeResponse(404, '');
    if (route.status >= 300 && route.status < 400 && route.location && init.redirect !== 'manual') {
      url = new URL(route.location, url).toString();
      continue;
    }
    return makeResponse(route.status, route.body ?? '');
  }
  throw new Error('fetchMock: too many redirects');
}

// Register the module mock before src/tools.ts is dynamically imported.
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

type ToolCallback = (args: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

let getPost: ToolCallback;

beforeAll(async () => {
  const { registerTools } = await import('../src/tools.js');
  // Recording server: captures the REAL callback and input schema. The test
  // never re-implements the tool's route construction.
  const registry: Record<string, { config: unknown; callback: ToolCallback }> = {};
  const fakeServer = {
    registerTool(name: string, config: unknown, callback: ToolCallback) {
      registry[name] = { config, callback };
      return undefined;
    },
  };
  registerTools(fakeServer as any);
  getPost = registry['get_post'].callback;
});

beforeEach(() => {
  requestedUrls = [];
  upstream = {};
});

describe('get_post post-reference resolution (regression)', () => {
  it('resolves a share-link post reference through the requested share route', async () => {
    upstream = {
      [SHARE_URL]: { status: 302, location: CANONICAL_PATH },
      [CANONICAL_URL]: { status: 200, body: VALID_POST_HTML },
      [WRONG_URL]: { status: 200, body: EMPTY_PAGE_HTML },
    };

    const result = await getPost({ ...HISTORICAL_ARGS });

    // Requested the share route, not the comments/<share-ref> route.
    expect(requestedUrls[0]).toBe(SHARE_URL);
    expect(requestedUrls).not.toContain(WRONG_URL);

    // Success, with the real post id and a non-empty title.
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(typeof payload.title).toBe('string');
    expect(payload.title.length).toBeGreaterThan(0);

    // Successful result shape / default comment_limit stay unchanged.
    expect(Array.isArray(payload.comments)).toBe(true);
    expect(payload.comments.length).toBeLessThanOrEqual(10);
    expect(typeof payload.commentCount).toBe('number');
  });

  it('returns isError for an HTTP-200 empty detail page', async () => {
    upstream = { '*': { status: 200, body: EMPTY_PAGE_HTML } };

    const result = await getPost({ ...HISTORICAL_ARGS });

    expect(result.isError).toBe(true);
  });
});
