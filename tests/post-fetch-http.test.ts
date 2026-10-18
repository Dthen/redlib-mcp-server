import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { fetchPostHtml, PostFetchError } from '../src/post-fetch.js';
import { parsePostReference } from '../src/post-reference.js';

/**
 * fetchPostHtml — transport proof over REAL loopback HTTP (Task 5b).
 *
 * Unlike `tests/post-fetch.test.ts` (an injected fake `fetch` that can only
 * prove wiring/decision logic), this suite drives the helper's DEFAULT,
 * UNMOCKED `node-fetch` against a `node:http` server bound to 127.0.0.1.
 *
 * There is NO `jest.unstable_mockModule`, NO global `fetch` replacement and NO
 * injected fake `Response` in this file: every assertion is produced by a real
 * TCP request against the configured REDLIB_URL origin. No internet is needed.
 *
 * What is proven here and could not be proven by the fake suite:
 *  - node-fetch's `size` option caps the FINAL, DECOMPRESSED body (a gzip body
 *    whose compressed size is under the injected cap but whose decompressed size
 *    is over it is rejected BEFORE any HTML is returned).
 *  - The single operation-wide AbortController/deadline covers stalled headers,
 *    a stalled partial body, an AGGREGATE redirect chain (each hop under the
 *    deadline, the sum over it) and the primary→fallback path (the deadline is
 *    NOT reset for the fallback).
 *  - Aborted/oversize requests release their socket, observable as a real
 *    server-side socket close before the teardown's forced cleanup.
 */

const VALID_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Example Post</title></head><body><main><div class="post">hello</div></main></body></html>';

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

const routes = new Map<string, RouteHandler>();
/** Every path the server actually served, in order (reset per test). */
let requests: string[] = [];
/** The server-side socket that carried each path (reset per test). */
const socketByPath = new Map<string, Socket>();
/** Live sockets accepted by the server, for teardown. */
const sockets = new Set<Socket>();
/** Fixture timers, cleared per test and at teardown so none fires late. */
const timers = new Set<NodeJS.Timeout>();

let server: Server;
let bases: { baseUrl: string; publicBaseUrl: string };

function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

/** Track a fixture timer so a late fire never crosses a test boundary. */
function after(ms: number, fn: () => void): void {
  const timer = setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {}
): void {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(buf.length),
    ...headers,
  });
  res.end(buf);
}

function plainRoute(body: string, status = 200, headers: Record<string, string> = {}): RouteHandler {
  return (_req, res) => send(res, status, body, headers);
}

/** Serve `body` gzip-compressed, so node-fetch must decompress before sizing. */
function gzipRoute(body: string, headers: Record<string, string> = {}): RouteHandler {
  return (_req, res) => {
    const buf = gzipSync(Buffer.from(body));
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': String(buf.length),
      ...headers,
    });
    res.end(buf);
  };
}

/** Serve `body` gzip-compressed as a still-open stream: the server writes the
 *  whole gzip member but NEVER ends the response, so a decompressed-size cap
 *  trips while the transfer is live (the client must destroy the stream). */
function gzipStreamRoute(body: string): RouteHandler {
  return (_req, res) => {
    const buf = gzipSync(Buffer.from(body));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
    res.write(buf);
    /* deliberately never end: the client must abort the oversize stream */
  };
}

function redirectRoute(status: number, location: string, delayMs = 0): RouteHandler {
  return (_req, res) => {
    const emit = () => {
      res.writeHead(status, { location });
      res.end();
    };
    if (delayMs > 0) after(delayMs, emit);
    else emit();
  };
}

function delayedStatusRoute(
  status: number,
  delayMs: number,
  body = '',
  headers: Record<string, string> = {}
): RouteHandler {
  return (_req, res) => {
    after(delayMs, () => send(res, status, body, headers));
  };
}

/** Accept the request but never send headers (client must abort). */
const stallHeadersRoute: RouteHandler = () => {
  /* deliberately no writeHead/end */
};

/** Send headers + a partial body, then stall forever (client must abort). */
const stallBodyRoute: RouteHandler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.write('<!DOCTYPE html><html><body>partial');
  /* deliberately never end */
};

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const path = req.url ?? '';
  requests.push(path);
  socketByPath.set(path, req.socket);
  const handler = routes.get(path);
  if (handler === undefined) {
    send(res, 404, 'no route for this fixture path');
    return;
  }
  handler(req, res);
}

/** Resolve true when the socket is destroyed/closed within `ms`. */
async function waitForSocketClose(socket: Socket | undefined, ms = 2000): Promise<boolean> {
  if (socket === undefined) return false;
  if (socket.destroyed) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      socket.off('close', onClose);
      resolve(socket.destroyed);
    }, ms);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    socket.once('close', onClose);
  });
}

beforeAll(async () => {
  server = createServer(handleRequest);
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  bases = { baseUrl: `http://127.0.0.1:${port}`, publicBaseUrl: 'https://www.reddit.com' };
});

afterEach(() => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  requests = [];
  socketByPath.clear();
});

afterAll(async () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  // Node >= 18.2: forcibly drop any connection a stalled route left open.
  const closeAll = (server as unknown as { closeAllConnections?: () => void }).closeAllConnections;
  if (typeof closeAll === 'function') closeAll.call(server);
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('fetchPostHtml over real HTTP — decompressed byte cap (Task 5b)', () => {
  it('rejects a body whose DECOMPRESSED size exceeds the injected cap, though the compressed size is under it', async () => {
    const MAX_BYTES = 1024;
    const decompressed =
      '<!DOCTYPE html><html lang="en"><body><main>' + 'x'.repeat(64 * 1024) + '</main></body></html>';
    const compressed = gzipSync(Buffer.from(decompressed));

    // Fixture facts: the wire (compressed) body is well under the cap, the
    // decompressed body is well over it. So a Content-Length-based check would
    // ACCEPT this response — only a decompressed-byte cap can reject it.
    expect(compressed.length).toBeLessThan(MAX_BYTES);
    expect(Buffer.byteLength(decompressed)).toBeGreaterThan(MAX_BYTES);

    route('/comments/gzipbig', gzipRoute(decompressed));
    const ref = parsePostReference('/comments/gzipbig', undefined, bases);

    // Control: with the DEFAULT 5 MiB cap the SAME response resolves and returns
    // the full decompressed HTML — proving the rejection below is the injected
    // cap, not the body/route/wiring.
    const ok = await fetchPostHtml(ref, bases);
    expect(ok.html).toBe(decompressed);
    expect(ok.expectedPostId).toBe('gzipbig');

    // Enforcement: the small injected cap rejects BEFORE returning HTML.
    await expect(
      fetchPostHtml(ref, bases, { limits: { maxBodyBytes: MAX_BYTES } })
    ).rejects.toMatchObject({ code: 'too-large' });
  });

  it('accepts a decompressed body exactly at the cap and below the cap', async () => {
    const MAX_BYTES = 2048;
    const atCap = 'y'.repeat(MAX_BYTES);
    const belowCap = 'z'.repeat(MAX_BYTES - 1);

    expect(Buffer.byteLength(atCap)).toBe(MAX_BYTES);
    expect(Buffer.byteLength(belowCap)).toBeLessThan(MAX_BYTES);

    route('/comments/atcap', plainRoute(atCap));
    route('/comments/belowcap', plainRoute(belowCap));

    const atRef = parsePostReference('/comments/atcap', undefined, bases);
    const belowRef = parsePostReference('/comments/belowcap', undefined, bases);

    const at = await fetchPostHtml(atRef, bases, { limits: { maxBodyBytes: MAX_BYTES } });
    expect(at.html).toBe(atCap);

    const below = await fetchPostHtml(belowRef, bases, { limits: { maxBodyBytes: MAX_BYTES } });
    expect(below.html).toBe(belowCap);
  });

  it('rejects a gzipped body over the cap and reports the typed error class', async () => {
    const MAX_BYTES = 512;
    const decompressed = '<html><body>' + 'a'.repeat(32 * 1024) + '</body></html>';
    route('/comments/gziperr', gzipRoute(decompressed));
    const ref = parsePostReference('/comments/gziperr', undefined, bases);

    await expect(
      fetchPostHtml(ref, bases, { limits: { maxBodyBytes: MAX_BYTES } })
    ).rejects.toBeInstanceOf(PostFetchError);
  });
});

describe('fetchPostHtml over real HTTP — operation-wide deadline (Task 5b)', () => {
  it('times out when the server never sends response headers', async () => {
    route('/comments/stallhdr', stallHeadersRoute);
    const ref = parsePostReference('/comments/stallhdr', undefined, bases);

    await expect(
      fetchPostHtml(ref, bases, { limits: { timeoutMs: 250 } })
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(requests).toContain('/comments/stallhdr');
  });

  it('times out when the server sends headers then stalls a partial body', async () => {
    route('/comments/stallbody', stallBodyRoute);
    const ref = parsePostReference('/comments/stallbody', undefined, bases);

    await expect(
      fetchPostHtml(ref, bases, { limits: { timeoutMs: 250 } })
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(requests).toContain('/comments/stallbody');
  });

  it('times out when a redirect chain aggregates past the shared deadline, though every hop is under it', async () => {
    const TIMEOUT_MS = 300;
    const HOP_DELAY_MS = 120;
    const HOPS = 4;

    // Fixture facts: each individual hop responds well before the deadline; the
    // AGGREGATE of the chain does not. A per-request (reset) deadline would let
    // this chain complete, so a timeout proves the deadline is operation-wide.
    expect(HOP_DELAY_MS).toBeLessThan(TIMEOUT_MS);
    expect(HOP_DELAY_MS * HOPS).toBeGreaterThan(TIMEOUT_MS);

    route('/r/x/s/t1', redirectRoute(302, '/r/x/s/t2', HOP_DELAY_MS));
    route('/r/x/s/t2', redirectRoute(302, '/r/x/s/t3', HOP_DELAY_MS));
    route('/r/x/s/t3', redirectRoute(302, '/r/x/s/t4', HOP_DELAY_MS));
    route('/r/x/s/t4', redirectRoute(302, '/comments/agg1', HOP_DELAY_MS));
    route('/comments/agg1', plainRoute(VALID_HTML));

    const ref = { path: '/r/x/s/t1' };
    await expect(
      fetchPostHtml(ref, bases, { limits: { timeoutMs: TIMEOUT_MS } })
    ).rejects.toMatchObject({ code: 'timeout' });

    // At least two hops were served (each under the deadline) before the shared
    // deadline expired — the failure is the aggregate, not a slow first hop.
    expect(requests).toContain('/r/x/s/t1');
    expect(requests).toContain('/r/x/s/t2');
  });

  it('does NOT reset the deadline for the primary→fallback path', async () => {
    const TIMEOUT_MS = 300;
    const PRIMARY_DELAY_MS = 200;
    const FALLBACK_DELAY_MS = 200;

    // Each leg alone fits the deadline; together they do not. A reset deadline
    // would let the fallback finish; a timeout proves the fallback shares it.
    expect(PRIMARY_DELAY_MS).toBeLessThan(TIMEOUT_MS);
    expect(PRIMARY_DELAY_MS + FALLBACK_DELAY_MS).toBeGreaterThan(TIMEOUT_MS);

    route('/r/webscraping/comments/dead01', delayedStatusRoute(404, PRIMARY_DELAY_MS));
    route(
      '/user/webscraping/comments/dead01',
      delayedStatusRoute(200, FALLBACK_DELAY_MS, VALID_HTML)
    );

    const ref = parsePostReference('dead01', 'webscraping', bases);
    expect(ref.fallbackPath).toBe('/user/webscraping/comments/dead01');

    await expect(
      fetchPostHtml(ref, bases, { limits: { timeoutMs: TIMEOUT_MS } })
    ).rejects.toMatchObject({ code: 'timeout' });

    // The delayed 404 was consumed and the fallback was actually issued — so the
    // timeout is the SHARED deadline expiring across both legs, not a stuck first.
    expect(requests).toContain('/r/webscraping/comments/dead01');
    expect(requests).toContain('/user/webscraping/comments/dead01');
  });

  it('completes a fast redirect chain using every redirect status (301/303/307/308) and a fast fallback', async () => {
    route('/r/webscraping/s/ctl1', redirectRoute(301, '/r/webscraping/s/ctl2'));
    route('/r/webscraping/s/ctl2', redirectRoute(303, '/r/webscraping/s/ctl3'));
    route('/r/webscraping/s/ctl3', redirectRoute(307, '/r/webscraping/comments/1x7hpcl/'));
    route('/r/webscraping/comments/1x7hpcl', redirectRoute(308, '/comments/1x7hpcl/'));
    route('/comments/1x7hpcl', plainRoute(VALID_HTML));

    const shareRef = parsePostReference('s/ctl1', 'webscraping', bases);
    const shared = await fetchPostHtml(shareRef, bases, { limits: { timeoutMs: 5000 } });
    expect(shared.html).toBe(VALID_HTML);
    expect(shared.expectedPostId).toBe('1x7hpcl');

    // Fast fallback control: the primary 404 → /user/ fallback resolves quickly.
    route('/r/webscraping/comments/fast01', plainRoute('not found', 404));
    route('/user/webscraping/comments/fast01', plainRoute(VALID_HTML));
    const hinted = parsePostReference('fast01', 'webscraping', bases);
    const fallback = await fetchPostHtml(hinted, bases, { limits: { timeoutMs: 5000 } });
    expect(fallback.html).toBe(VALID_HTML);
    expect(fallback.expectedPostId).toBe('fast01');
  });
});

describe('fetchPostHtml over real HTTP — socket/body release and fixture hygiene (Task 5b)', () => {
  it('releases the request socket when a stalled-headers request is aborted', async () => {
    route('/comments/releasehdr', stallHeadersRoute);
    const ref = parsePostReference('/comments/releasehdr', undefined, bases);

    await expect(
      fetchPostHtml(ref, bases, { limits: { timeoutMs: 250 } })
    ).rejects.toMatchObject({ code: 'timeout' });

    // Observable close BEFORE teardown's forced cleanup.
    const closed = await waitForSocketClose(socketByPath.get('/comments/releasehdr'));
    expect(closed).toBe(true);
  });

  it('releases the request socket when an oversize body is aborted mid-read', async () => {
    const MAX_BYTES = 512;
    const decompressed = '<html><body>' + 'b'.repeat(48 * 1024) + '</body></html>';
    // Streamed (still-open) response so the cap trips while the transfer is live.
    route('/comments/releasebig', gzipStreamRoute(decompressed));
    const ref = parsePostReference('/comments/releasebig', undefined, bases);

    await expect(
      fetchPostHtml(ref, bases, { limits: { maxBodyBytes: MAX_BYTES } })
    ).rejects.toMatchObject({ code: 'too-large' });

    const closed = await waitForSocketClose(socketByPath.get('/comments/releasebig'));
    expect(closed).toBe(true);
  });

  it('drives real loopback sockets with the default node-fetch and installs no global fetch mock', async () => {
    // No `jest.unstable_mockModule` / global fetch replacement in this suite.
    expect((globalThis as unknown as { fetch?: { mock?: unknown } }).fetch?.mock).toBeUndefined();

    route('/comments/real01', plainRoute(VALID_HTML));
    const ref = parsePostReference('/comments/real01', undefined, bases);

    // No `fetch`, no `limits`: the helper's own default node-fetch is used.
    const result = await fetchPostHtml(ref, bases);
    expect(result.html).toBe(VALID_HTML);
    expect(result.expectedPostId).toBe('real01');
    expect(requests).toContain('/comments/real01');
  });
});

describe('fetchPostHtml over real HTTP — canonical id-case redirect (follow-up)', () => {
  it('follows a real loopback redirect that changes only the id case, preserving the requested spelling', async () => {
    route('/comments/1X7HPCL', redirectRoute(302, '/comments/1x7hpcl'));
    route('/comments/1x7hpcl', plainRoute(VALID_HTML));

    // No injected fetch: the helper's own default node-fetch drives real sockets.
    const ref = parsePostReference('/comments/1X7HPCL', undefined, bases);
    const result = await fetchPostHtml(ref, bases);

    expect(result.html).toBe(VALID_HTML);
    expect(result.expectedPostId).toBe('1X7HPCL');
    expect(requests).toEqual(['/comments/1X7HPCL', '/comments/1x7hpcl']);
  });
});

describe('fetchPostHtml over real HTTP — same-origin configured prefix selection (follow-up)', () => {
  it('starts from a public-prefixed reference and follows a public-prefixed canonical redirect', async () => {
    const origin = bases.baseUrl;
    const prefixed = { baseUrl: `${origin}/internal`, publicBaseUrl: `${origin}/public` };

    // Distinct logical paths (scoped post route -> unscoped canonical route), so
    // the redirect is a genuine canonicalisation and not a same-path loop.
    route(
      '/internal/r/webscraping/comments/1x7hpcl',
      redirectRoute(302, `${origin}/public/comments/1x7hpcl`)
    );
    route('/internal/comments/1x7hpcl', plainRoute(VALID_HTML));

    const ref = parsePostReference(
      `${origin}/public/r/webscraping/comments/1x7hpcl`,
      undefined,
      prefixed
    );
    expect(ref).toEqual({ path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' });

    // No injected fetch: the helper's own default node-fetch drives real sockets.
    const result = await fetchPostHtml(ref, prefixed);

    expect(result.html).toBe(VALID_HTML);
    expect(result.expectedPostId).toBe('1x7hpcl');
    // The internal prefix appears exactly once per request; the public prefix is
    // a reference origin and is NEVER put on the wire.
    expect(requests).toEqual([
      '/internal/r/webscraping/comments/1x7hpcl',
      '/internal/comments/1x7hpcl',
    ]);
    expect(requests.some((path) => path.includes('/public'))).toBe(false);
  });
});
