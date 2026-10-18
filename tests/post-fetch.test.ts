import { Response, Headers } from 'node-fetch';
import { jest } from '@jest/globals';
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

// Record a dispose (destroy/resume) on the REAL node-fetch body stream so a test
// can prove the helper releases a redirect/fallback/error body BEFORE the next
// request. The stream is a Node `Readable`; `disposeBody` prefers `destroy()`.
function instrumentDisposal(res: Response, url: string, events: string[]): void {
  const body = (res as any).body;
  if (!body) return;
  for (const method of ['destroy', 'resume'] as const) {
    const original = typeof body[method] === 'function' ? body[method].bind(body) : undefined;
    if (!original) continue;
    body[method] = (...args: any[]) => {
      events.push(`dispose:${url}`);
      return original(...args);
    };
  }
}

function makeFetch(routes: Record<string, Route>) {
  const requested: string[] = [];
  const inits: any[] = [];
  const events: string[] = [];
  const fetchImpl = async (url: string, init: any) => {
    requested.push(url);
    inits.push(init);
    events.push(`request:${url}`);
    const route = routes[url] ?? routes['*'];
    // A missing route is a 404 so an unexpected URL is caught by the exact
    // `requested` assertions rather than masked by an exception.
    if (route === undefined) return new Response('', { status: 404 });
    const headers = new Headers();
    if (route.location !== undefined) headers.set('location', route.location);
    const body = route.body === undefined ? null : route.body;
    const res = new Response(body, { status: route.status, headers });
    instrumentDisposal(res, url, events);
    return res;
  };
  return { fetchImpl, requested, inits, events };
}

interface RunResult {
  result?: { html: string; expectedPostId?: string };
  error?: Error;
  requested: string[];
  inits: any[];
  events: string[];
}

async function runFetch(
  ref: Parameters<typeof fetchPostHtml>[0],
  routes: Record<string, Route>,
  options: Parameters<typeof fetchPostHtml>[2] = {},
  bases: { baseUrl: string; publicBaseUrl: string } = BASES
): Promise<RunResult> {
  const { fetchImpl, requested, inits, events } = makeFetch(routes);
  try {
    const result = await fetchPostHtml(ref, bases, { ...options, fetch: fetchImpl });
    return { result, requested, inits, events };
  } catch (error) {
    return { error: error as Error, requested, inits, events };
  }
}

// Every request the helper issues must target the configured Redlib origin (+ its
// base-path prefix); nothing else may ever appear on the wire.
function expectAllOnConfiguredOrigin(requested: string[], origin = BASE, prefix = ''): void {
  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) {
    expect(url.startsWith(`${origin}${prefix}/`)).toBe(true);
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

describe('fetchPostHtml — raw redirect shapes must not be normalised away (Task 5)', () => {
  // A share ref has NO expected id, so a redirect that collapses a raw traversal
  // into `/comments/<other-id>` would be silently accepted and the wrong post
  // fetched. WHATWG URL resolution collapses BOTH literal `..` and `%2e%2e`
  // segments before the pure parser can reject them, so the raw Location must be
  // gated first — exactly as the same string would be rejected as INPUT.
  it('rejects a raw literal traversal redirect and never fetches the normalised destination', async () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);
    expect(ref.expectedPostId).toBeUndefined();

    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/a/../../../comments/2y8iqdm',
      },
      [`${BASE}/comments/2y8iqdm`]: { status: 200, body: VALID_HTML },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/r/webscraping/s/yf4R7bbaHP`]);
  });

  it('rejects a raw percent-encoded traversal redirect and never fetches the destination', async () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);

    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/a/%2e%2e/comments/2y8iqdm',
      },
      [`${BASE}/comments/2y8iqdm`]: { status: 200, body: VALID_HTML },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/r/webscraping/s/yf4R7bbaHP`]);
  });

  it.each([
    ['backslash separators', '\\evil.example.com\\comments\\1x7hpcl'],
    ['a malformed scheme separator', 'https:////redlib.test:8080/comments/1x7hpcl'],
    ['a double-encoded traversal', '/comments/%252e%252e/2y8iqdm'],
  ])('rejects %s in a redirect and never fetches the resolved target', async (_name, location) => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: { status: 302, location },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/r/webscraping/s/yf4R7bbaHP`]);
  });
});

describe('fetchPostHtml — adversarial redirect matrix (Task 5)', () => {
  it('rejects a credential-bearing (userinfo) redirect and never fetches it', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: {
        status: 302,
        location: 'http://user:pass@redlib.test:8080/comments/1x7hpcl',
      },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('rejects a protocol-relative redirect before any resolution', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: {
        status: 302,
        location: '//evil.example.com/comments/1x7hpcl',
      },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>'])(
    'rejects the non-HTTP redirect scheme %s',
    async (location) => {
      const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
      const { error, requested } = await runFetch(ref, {
        [`${BASE}/comments/1x7hpcl`]: { status: 302, location },
      });

      expect((error as PostFetchError).code).toBe('unsafe-redirect');
      expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
    }
  );

  it('rejects a redirect to an unsupported route', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302, location: '/search?q=secret' },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/comments/1x7hpcl',
    'https://arbitrary.example.org/comments/1x7hpcl',
  ])('rejects the arbitrary/private redirect origin %s before I/O', async (location) => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302, location },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('rejects a redirect response with a missing Location header', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302 },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });

  it('rejects a redirect response with a malformed Location URL', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1x7hpcl`]: { status: 302, location: 'http://[::1' },
    });

    expect((error as PostFetchError).code).toBe('unsafe-redirect');
    expect(requested).toEqual([`${BASE}/comments/1x7hpcl`]);
  });
});

describe('fetchPostHtml — origin and identity boundaries (Task 5)', () => {
  it('accepts a deliberately different publicBaseUrl origin as a reference but fetches only the Redlib origin', async () => {
    const bases = { baseUrl: BASE, publicBaseUrl: 'https://public.redlib.example' };
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', bases);
    const shareUrl = `${BASE}/r/webscraping/s/yf4R7bbaHP`;
    const canonicalUrl = `${BASE}/r/webscraping/comments/1x7hpcl`;

    const { result, requested } = await runFetch(
      ref,
      {
        [shareUrl]: {
          status: 302,
          location: 'https://public.redlib.example/r/webscraping/comments/1x7hpcl/',
        },
        [canonicalUrl]: { status: 200, body: VALID_HTML },
      },
      {},
      bases
    );

    expect(requested).toEqual([shareUrl, canonicalUrl]);
    expect(requested.some((u) => u.includes('public.redlib.example'))).toBe(false);
    expect(result?.expectedPostId).toBe('1x7hpcl');
    expectAllOnConfiguredOrigin(requested);
  });

  it('keeps every request on the configured origin and base path across a multi-hop chain', async () => {
    const bases = { baseUrl: `${BASE}/redlib`, publicBaseUrl: 'https://www.reddit.com' };
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };

    const { requested } = await runFetch(
      ref,
      {
        [`${BASE}/redlib/r/webscraping/s/yf4R7bbaHP`]: {
          status: 302,
          location: '/redlib/r/webscraping/comments/1x7hpcl/',
        },
        [`${BASE}/redlib/r/webscraping/comments/1x7hpcl`]: {
          status: 302,
          location: '/redlib/comments/1x7hpcl/',
        },
        [`${BASE}/redlib/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
      },
      {},
      bases
    );

    expect(requested).toEqual([
      `${BASE}/redlib/r/webscraping/s/yf4R7bbaHP`,
      `${BASE}/redlib/r/webscraping/comments/1x7hpcl`,
      `${BASE}/redlib/comments/1x7hpcl`,
    ]);
    expectAllOnConfiguredOrigin(requested, BASE, '/redlib');
  });

  it('selects the public prefix of a same-origin configured base and fetches only the internal prefix', async () => {
    const bases = { baseUrl: `${BASE}/internal`, publicBaseUrl: `${BASE}/public` };
    const ref = parsePostReference(`${BASE}/public/r/webscraping/comments/1x7hpcl`, undefined, bases);
    expect(ref).toEqual({ path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' });

    const internalPrimary = `${BASE}/internal/r/webscraping/comments/1x7hpcl`;
    const internalCanonical = `${BASE}/internal/comments/1x7hpcl`;
    const { result, requested } = await runFetch(
      ref,
      {
        [internalPrimary]: {
          status: 302,
          location: `${BASE}/public/comments/1x7hpcl/`,
        },
        [internalCanonical]: { status: 200, body: VALID_HTML },
      },
      {},
      bases
    );

    // The public prefix is a reference origin only: it never reaches the wire,
    // and the internal prefix is prepended exactly once per request.
    expect(requested).toEqual([internalPrimary, internalCanonical]);
    expect(requested.some((u) => u.includes('/public'))).toBe(false);
    expect(result?.expectedPostId).toBe('1x7hpcl');
    expect(result?.html).toBe(VALID_HTML);
    expectAllOnConfiguredOrigin(requested, BASE, '/internal');
  });

  it('rejects an arbitrary input origin in the pure grammar before any I/O', () => {
    // The helper consumes an already-parsed ref whose `path` is origin-free, so
    // an input URL on an unconfigured origin can never reach the wire: the grammar
    // refuses it first.
    expect(() =>
      parsePostReference('https://arbitrary.example.org/comments/1x7hpcl', undefined, BASES)
    ).toThrow(/Unsupported post reference/);
  });

  it('cannot be pointed at another origin even with a hand-built hostile path', async () => {
    const ref = { path: '//evil.example.com/comments/1x7hpcl' };
    const url = `${BASE}//evil.example.com/comments/1x7hpcl`;
    const { requested } = await runFetch(ref, { [url]: { status: 200, body: VALID_HTML } });

    expect(requested).toEqual([url]);
    expectAllOnConfiguredOrigin(requested);
  });

  it('retains an undefined expected id for a share that returns no canonical redirect', async () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);
    expect(ref.expectedPostId).toBeUndefined();

    const { result, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: { status: 200, body: VALID_HTML },
    });

    expect(result?.html).toBe(VALID_HTML);
    expect(result?.expectedPostId).toBeUndefined();
    expect(requested).toEqual([`${BASE}/r/webscraping/s/yf4R7bbaHP`]);
  });

  it('accepts a redirect that changes only the id case and preserves the requested spelling', async () => {
    const ref = { path: '/comments/1X7HPCL', expectedPostId: '1X7HPCL' };
    const { result, error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1X7HPCL`]: { status: 302, location: '/comments/1x7hpcl' },
      [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(error).toBeUndefined();
    expect(result?.html).toBe(VALID_HTML);
    expect(result?.expectedPostId).toBe('1X7HPCL');
    expect(requested).toEqual([`${BASE}/comments/1X7HPCL`, `${BASE}/comments/1x7hpcl`]);
    expectAllOnConfiguredOrigin(requested);
  });

  it('follows a share through two canonical redirects that differ only in id case', async () => {
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };
    const { result, error, requested } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/r/webscraping/comments/1X7HPCL',
      },
      [`${BASE}/r/webscraping/comments/1X7HPCL`]: { status: 302, location: '/comments/1x7hpcl' },
      [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(error).toBeUndefined();
    expect(result?.html).toBe(VALID_HTML);
    expect(result?.expectedPostId).toBe('1X7HPCL');
    expect(requested).toEqual([
      `${BASE}/r/webscraping/s/yf4R7bbaHP`,
      `${BASE}/r/webscraping/comments/1X7HPCL`,
      `${BASE}/comments/1x7hpcl`,
    ]);
    expectAllOnConfiguredOrigin(requested);
  });

  it('still rejects a genuinely different redirected id before requesting it', async () => {
    const ref = { path: '/comments/1X7HPCL', expectedPostId: '1X7HPCL' };
    const { error, requested } = await runFetch(ref, {
      [`${BASE}/comments/1X7HPCL`]: { status: 302, location: '/comments/2Y8IQDM' },
      [`${BASE}/comments/2Y8IQDM`]: { status: 200, body: VALID_HTML },
    });

    expect((error as PostFetchError).code).toBe('redirect-id-conflict');
    expect(requested).toEqual([`${BASE}/comments/1X7HPCL`]);
  });
});

describe('fetchPostHtml — operation-wide wiring and body disposal (Task 5)', () => {
  it('forwards the SAME AbortSignal across every request in a redirect chain', async () => {
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };
    const { inits } = await runFetch(ref, {
      [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
        status: 302,
        location: '/r/webscraping/comments/1x7hpcl/',
      },
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 302, location: '/comments/1x7hpcl/' },
      [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(inits).toHaveLength(3);
    expect(inits.every((init) => init.signal === inits[0].signal)).toBe(true);
  });

  it('forwards the SAME AbortSignal across the primary and fallback requests', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const { inits } = await runFetch(ref, {
      [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 404 },
      [`${BASE}/user/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect(inits).toHaveLength(2);
    expect(inits[1].signal).toBe(inits[0].signal);
  });

  it('passes redirect:manual and the size cap on every request, honouring a test override', async () => {
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP' };
    const { inits } = await runFetch(
      ref,
      {
        [`${BASE}/r/webscraping/s/yf4R7bbaHP`]: {
          status: 302,
          location: '/r/webscraping/comments/1x7hpcl/',
        },
        [`${BASE}/r/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
      },
      { limits: { maxBodyBytes: 1024 } }
    );

    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init.redirect).toBe('manual');
      expect(init.size).toBe(1024);
    }
  });

  it('disposes the redirect body BEFORE issuing the next request', async () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', BASES);
    const shareUrl = `${BASE}/r/webscraping/s/yf4R7bbaHP`;
    const canonicalUrl = `${BASE}/r/webscraping/comments/1x7hpcl`;

    const { requested, events } = await runFetch(ref, {
      [shareUrl]: {
        status: 302,
        body: 'redirecting',
        location: '/r/webscraping/comments/1x7hpcl/',
      },
      [canonicalUrl]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([shareUrl, canonicalUrl]);
    const disposeIdx = events.indexOf(`dispose:${shareUrl}`);
    const nextIdx = events.indexOf(`request:${canonicalUrl}`);
    expect(disposeIdx).toBeGreaterThanOrEqual(0);
    expect(nextIdx).toBeGreaterThan(disposeIdx);
  });

  it('disposes the primary body before the fallback request', async () => {
    const ref = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const primaryUrl = `${BASE}/r/webscraping/comments/1x7hpcl`;
    const fallbackUrl = `${BASE}/user/webscraping/comments/1x7hpcl`;

    const { requested, events } = await runFetch(ref, {
      [primaryUrl]: { status: 404, body: 'not found' },
      [fallbackUrl]: { status: 200, body: VALID_HTML },
    });

    expect(requested).toEqual([primaryUrl, fallbackUrl]);
    const disposeIdx = events.indexOf(`dispose:${primaryUrl}`);
    expect(disposeIdx).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(`request:${fallbackUrl}`)).toBeGreaterThan(disposeIdx);
  });

  it('disposes a terminal error body before throwing', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const url = `${BASE}/comments/1x7hpcl`;

    const { error, requested, events } = await runFetch(ref, {
      [url]: { status: 500, body: 'server error' },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(requested).toEqual([url]);
    expect(events).toContain(`dispose:${url}`);
  });

  it('does not fall back to the hint route after a redirect has already occurred', async () => {
    const hinted = parsePostReference('1x7hpcl', 'webscraping', BASES);
    const shareUrl = `${BASE}/r/webscraping/s/yf4R7bbaHP`;
    const ref = { path: '/r/webscraping/s/yf4R7bbaHP', fallbackPath: hinted.fallbackPath };

    const { error, requested } = await runFetch(ref, {
      [shareUrl]: { status: 302, location: '/comments/1x7hpcl/' },
      [`${BASE}/comments/1x7hpcl`]: { status: 404 },
      [`${BASE}/user/webscraping/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
    });

    expect((error as PostFetchError).code).toBe('http-status');
    expect(requested).toEqual([shareUrl, `${BASE}/comments/1x7hpcl`]);
  });

  it('leaves no pending operation timer once the operation settles (wiring)', async () => {
    jest.useFakeTimers();
    try {
      const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
      const { result } = await runFetch(ref, {
        [`${BASE}/comments/1x7hpcl`]: { status: 200, body: VALID_HTML },
      });

      expect(result?.html).toBe(VALID_HTML);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps a network failure to a typed error', async () => {
    const ref = { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' };
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(fetchPostHtml(ref, BASES, { fetch: boom as any })).rejects.toMatchObject({
      code: 'network',
    });
  });
});
