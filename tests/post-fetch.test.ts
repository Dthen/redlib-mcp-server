import { Response, Headers } from 'node-fetch';
import { fetchPostHtml, PostFetchError } from '../src/post-fetch.js';
import { parsePostReference } from '../src/post-reference.js';

/**
 * fetchPostHtml — bounded Redlib-only post fetch (Task 4).
 *
 * These tests drive the helper through an INJECTED fake fetch that returns REAL
 * node-fetch `Response`/`Headers` objects, so the assertions cover the helper's
 * own routing/decision logic (redirect resolution, remap, fallback, sort
 * forwarding, limits) — NOT socket behavior.
 *
 * Honest scope: an injected fake fetch cannot prove real socket redirects, the
 * node-fetch `size` cap against a live decompressed body, or real abort timing.
 * Those remain Task 5b (real local HTTP suite). Here we assert the exact
 * requested URLs and the wiring passed to `fetch` (redirect:'manual', size,
 * signal).
 */

const BASES = { baseUrl: 'http://redlib.test:8080', publicBaseUrl: 'https://www.reddit.com' };
const BASE = 'http://redlib.test:8080';

const VALID_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Example Post</title></head><body><main><div class="post">hello</div></main></body></html>';
const EMPTY_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Redlib</title></head><body><main></main></body></html>';

type Route = { status: number; body?: string | null; location?: string };

function makeFetch(routes: Record<string, Route>) {
  const requested: string[] = [];
  const inits: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    requested.push(url);
    inits.push(init);
    const route = routes[url] ?? routes['*'];
    // A missing route is a 404 so an unexpected URL is caught by the exact
    // `requested` assertions rather than masked by an exception.
    if (route === undefined) return new Response('', { status: 404 });
    const headers = new Headers();
    if (route.location !== undefined) headers.set('location', route.location);
    const body = route.body === undefined ? null : route.body;
    return new Response(body, { status: route.status, headers });
  };
  return { fetchImpl, requested, inits };
}

interface RunResult {
  result?: { html: string; expectedPostId?: string };
  error?: Error;
  requested: string[];
  inits: any[];
}

async function runFetch(
  ref: Parameters<typeof fetchPostHtml>[0],
  routes: Record<string, Route>,
  options: Parameters<typeof fetchPostHtml>[2] = {},
  bases: { baseUrl: string; publicBaseUrl: string } = BASES
): Promise<RunResult> {
  const { fetchImpl, requested, inits } = makeFetch(routes);
  try {
    const result = await fetchPostHtml(ref, bases, { ...options, fetch: fetchImpl });
    return { result, requested, inits };
  } catch (error) {
    return { error: error as Error, requested, inits };
  }
}

describe('fetchPostHtml — valid response and redirect chain', () => {
  it('returns HTML for a direct 200 and wires manual redirects, size cap and signal', async () => {
    const ref = parsePostReference('/comments/1x7hpcl', undefined, BASES);
    const { result, requested, inits } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
    expect(result?.html).toBe(VALID_HTML);
    expect(result?.expectedPostId).toBe('1x7hpcl');

    expect(inits[0].redirect).toBe('manual');
    expect(inits[0].size).toBe(5 * 1024 * 1024);
    expect(inits[0].signal).toBeDefined();
  });

  it('prepends the configured base path prefix exactly once', async () => {
    const bases = { baseUrl: 'http://redlib.test:8080/redlib', publicBaseUrl: 'https://www.reddit.com' };
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { result, requested } = await runFetch(
      ref,
      { [`${BASE}/redlib/comments/1x7hpcl`]: { status: 200, body: VALID_HTML } },
      {},
      bases
    );

    expect(requested).toEqual([`${BASE}/redlib/comments/1x7hpcl`]);
    expect(result?.html).toBe(VALID_HTML);
  });

  it('follows a relative share redirect to the canonical route and adopts the id', async () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);
    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/r/webscraping/comments/1x7hpcl/example_share_post/',
      },
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([
      `${BASE}/r/webscraping/s/yf4R7bbaHP`,
      `${BASE}/r/webscraping/comments/1x7hpcl`,
    ]);
    expect(result?.expectedPostId).toBe('1x7hpcl');
    expect(result?.html).toBe(VALID_HTML);
  });

  it('rewrites an absolute Reddit redirect onto the Redlib origin', async () => {
    const ref = parsePostReference('https://www.reddit.com/r/webscraping/s/yf4R7bbaHP', undefined, BASES);
    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl/example_share_post/',
      },
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([
      `${BASE}/r/webscraping/s/yf4R7bbaHP`,
      `${BASE}/r/webscraping/comments/1x7hpcl`,
    ]);
    expect(requested.some((u) => u.includes('reddit.com'))).toBe(false);
    expect(result?.expectedPostId).toBe('1x7hpcl');
  });

  it('follows a second same-instance redirect within the hop budget', async () => {
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };
    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/r/webscraping/comments/1x7hpcl/example_share_post/',
      },
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: {
        status: 302,
        location: '/comments/1x7hpcl/final/',
      },
      [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([
      `${BASE}/r/webscraping/s/yf4R7bbaHP`,
      `${BASE}/r/webscraping/comments/1x7hpcl`,
      `${BASE}/comments/1x7hpcl`,
    ]);
    expect(result?.expectedPostId).toBe('1x7hpcl');
  });
});

describe('fetchPostHtml — legacy 404 fallback', () => {
  it('falls back from a hinted /r/ route to /user/ on a primary 404', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    expect(ref.fallbackPath).toBe('/user/webscraping/comments/1x7hpcl');

    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 404 },
      [`${BASE}/user/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([
      `${BASE}/r/webscraping/comments/1x7hpcl`,
      `${BASE}/user/webscraping/comments/1x7hpcl`,
    ]);
    expect(result?.expectedPostId).toBe('1x7hpcl');
    expect(result?.html).toBe(VALID_HTML);
  });

  it('does not fall back for an unhinted reference', async () => {
    const ref = parsePostReference('1x7hpcl', undefined, BASES);
    expect(ref.fallbackPath).toBeUndefined();

    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 404 },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('does not fall back for an explicit scoped reference', async () => {
    const ref = parsePostReference('/r/webscraping/comments/1x7hpcl', undefined, BASES);
    expect(ref.fallbackPath).toBeUndefined();

    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 404 },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl`]);
  });

  it('does not fall back on a 403', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 403 },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(error?.message).toContain('403');
    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl`]);
  });

  it('does not fall back on a 429', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 429 },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(error?.message).toContain('429');
    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl`]);
  });

  it('returns an HTTP-200 empty page as HTML without falling back', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const { result, error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 200, body: EMPTY_HTML },
    });

    expect(error).toBeUndefined();
    expect(result?.html).toBe(EMPTY_HTML);
    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl`]);
  });
});

describe('fetchPostHtml — comment-sort forwarding', () => {
  it('forwards the reference sort across redirect and fallback, dropping tracking query', async () => {
    const ref = parsePostReference('1x7hpcl?sort=top', 'webscraping', BASES);
    expect(ref.urlCommentSort).toBe('top');

    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl?sort=top`]: { status: 404 },
      [`${BASE}/user/webscraping/comments/1x7hpcl?sort=top`]: {
        status: 302,
        location: '/comments/1x7hpcl/final/?utm_source=x&sort=new',
      },
      [`${BASE}/comments/1x7hpcl?sort=top`]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([
      `${BASE}/r/webscraping/comments/1x7hpcl?sort=top`,
      `${BASE}/user/webscraping/comments/1x7hpcl?sort=top`,
      `${BASE}/comments/1x7hpcl?sort=top`,
    ]);
    expect(requested.some((u) => u.includes('utm_source'))).toBe(false);
    expect(result?.html).toBe(VALID_HTML);
  });

  it('lets an explicit commentSort override the reference sort', async () => {
    const ref = parsePostReference('1x7hpcl?sort=top', 'webscraping', BASES);
    const { requested } = await runFetch(
      ref,
      { [`${BASE}/r/webscraping/comments/1x7hpcl?sort=new`]: { status: 200, body: VALID_HTML } },
      { commentSort: 'new' }
    );

    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl?sort=new`]);
  });
});

describe('fetchPostHtml — bounded redirect safety decisions', () => {
  it('rejects a redirect to an external host', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302, location: 'https://evil.example.com/comments/1x7hpcl' },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('rejects an https->http redirect downgrade', async () => {
    const bases = { baseUrl: 'https://redlib.secure.test', publicBaseUrl: 'https://www.reddit.com' };
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(
      ref,
      {
        'https://redlib.secure.test/comments/1x7hpcl': {
          status: 302,
          location: 'http://redlib.secure.test/comments/1x7hpcl',
        },
      },
      {},
      bases
    );

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual(['https://redlib.secure.test/comments/1x7hpcl']);
  });

  it('rejects a non-HTTP redirect scheme', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302, location: 'ftp://redlib.test/x' },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('rejects a redirect loop', async () => {
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/r/webscraping/s/yf4R7bbaHP',
      },
    });

    expect((error as PostFetchError).code).toBe('redirect-loop');
    expect(requested).toEqual([`${BASE}/r/webscraping/s/yf4R7bbaHP`]);
  });

  it('stops after the maximum redirect hops', async () => {
    const ref = { path: '/r/x/s/tok1' };
    const routes: Record<string, Route> = {};
    for (let i = 1; i <= 6; i++) {
      routes[`${BASE}/r/x/s/tok${i}`] = { status: 302, location: `/r/x/s/tok${i + 1}` };
    }
    const { error, requested } = await runFetch(ref, routes);

    expect((error as PostFetchError).code).toBe('too-many-redirects');
    expect(requested).toEqual([
      `${BASE}/r/x/s/tok1`,
      `${BASE}/r/x/s/tok2`,
      `${BASE}/r/x/s/tok3`,
      `${BASE}/r/x/s/tok4`,
      `${BASE}/r/x/s/tok5`,
      `${BASE}/r/x/s/tok6`,
    ]);
  });

  it('fails a conflicting id-bearing redirect instead of switching id', async () => {
    const ref = { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 302, location: '/comments/2y8iqdm' },
    });

    expect((error as PostFetchError).code).toBe('redirect-id-conflict');
    expect(requested).toEqual([`${BASE}/r/webscraping/comments/1x7hpcl`]);
  });

  it('maps an operation timeout to a typed error', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const hanging = (_url: string, init: any) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(
      fetchPostHtml(ref, BASES, { fetch: hanging as any, limits: { timeoutMs: 20 } })
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps an oversize body to a typed error', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const oversize = async () => {
      const res = new Response('x', { status: 200 });
      (res as any).text = async () => {
        const err: any = new Error('content size over limit');
        err.type = 'max-size';
        throw err;
      };
      return res;
    };

    await expect(fetchPostHtml(ref, BASES, { fetch: oversize as any })).rejects.toMatchObject({
      code: 'too-large',
    });
  });
});
