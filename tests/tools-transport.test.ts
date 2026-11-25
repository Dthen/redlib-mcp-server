import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { McpServer, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/server';
import { registerTools } from '../src/tools.js';

/**
 * Batch D transport proof over REAL owned loopback HTTP.
 *
 * Every call below drives the REAL handler callbacks registered by
 * `registerTools` against a `node:http` fixture server bound to 127.0.0.1.
 * There is no module mock and no injected `Response`: the handlers' own
 * default `node-fetch` is used, so redirect confinement, decompressed body
 * caps, the operation deadline and sibling/socket cleanup are observed on
 * real sockets.
 *
 * Registrations inject only the test-only runtime seam (`baseUrl` + shortened
 * operation limits); production defaults (30 s / 5 hops / 5 MiB) are asserted
 * separately and are never changed by these tests.
 */

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

const routes = new Map<string, RouteHandler>();
let requests: string[] = [];
const socketByPath = new Map<string, Socket>();
const sockets = new Set<Socket>();
const timers = new Set<NodeJS.Timeout>();

let server: Server;
let origin: string;

interface Registry {
  [name: string]: {
    config: { inputSchema: { parse: (value: unknown) => any }; [key: string]: unknown };
    callback: (args: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  };
}

function register(baseUrl: string, limits?: { timeoutMs?: number; maxRedirects?: number; maxBodyBytes?: number }): Registry {
  const registry: Registry = {};
  const fakeServer = {
    registerTool(name: string, config: Registry[string]['config'], callback: Registry[string]['callback']) {
      registry[name] = { config, callback };
      return undefined;
    },
  };
  registerTools(fakeServer as any, { baseUrl, limits });
  return registry;
}

function call(registry: Registry, name: string, args: unknown) {
  const tool = registry[name];
  return tool.callback(tool.config.inputSchema.parse(args));
}

/**
 * Minimal raw JSON-RPC client half for a real `McpServer` connection. Messages
 * are fed to the SDK's own protocol dispatcher; server replies are captured
 * here. This exercises the SDK boundary (including its input validation and
 * defaulting), not `inputSchema.parse` inside the test.
 */
class RawClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly replies: JSONRPCMessage[] = [];
  private readonly waiters: Array<() => void> = [];

  async start(): Promise<void> {}
  async close(): Promise<void> {
    this.onclose?.();
  }
  async send(message: JSONRPCMessage): Promise<void> {
    this.replies.push(message);
    for (const wake of this.waiters.splice(0)) wake();
  }
  sendToServer(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
  async replyFor(id: number, deadlineMs = 5000): Promise<any> {
    const deadline = Date.now() + deadlineMs;
    while (!this.replies.some((message: any) => message.id === id)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no SDK reply for request ${id}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no SDK reply for request ${id}`)), left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.replies.find((message: any) => message.id === id);
  }
}

function after(ms: number, fn: () => void): void {
  const timer = setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(buf.length),
    ...headers,
  });
  res.end(buf);
}

function plain(body: string, status = 200, headers: Record<string, string> = {}): RouteHandler {
  return (_req, res) => send(res, status, body, headers);
}

/** Headers + a partial body that never ends: only disposal can release it. */
function reluctant(status: number, headers: Record<string, string> = {}): RouteHandler {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.write('<!DOCTYPE html><html><body>partial');
  };
}

const stallHeaders: RouteHandler = () => {
  /* deliberately no headers */
};

const stallBody: RouteHandler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.write('<!DOCTYPE html><html><body>partial');
};

function gzipStream(body: string): RouteHandler {
  return (_req, res) => {
    const buf = gzipSync(Buffer.from(body));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
    res.write(buf);
    /* never ends: the decompressed cap must abort the live stream */
  };
}

function redirect(status: number, location: string): RouteHandler {
  return (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
}

/** Delay the first response so a fast local failure cannot beat the peer's connect. */
function delayed(handler: RouteHandler, ms = 50): RouteHandler {
  return (req, res) => after(ms, () => handler(req, res));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
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

const LISTING_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Demo</title></head><body><main>' +
  '<div id="column_one"><div id="posts"></div></div></main></body></html>';

const WIKI_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>a/b - demo</title></head><body><main>' +
  '<div class="panel" id="column_one"><div id="wiki"><div class="md wiki"></div></div></div>' +
  '</main></body></html>';

const USER_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>spez (u/spez) - Redlib</title></head><body><main>' +
  '<div id="column_one"><div id="posts"></div></div>' +
  '<aside><div class="panel" id="user"><h1 id="user_title">spez</h1><p id="user_name">u/spez</p>' +
  '<div id="user_description"></div><div id="user_details"></div></div></aside>' +
  '</main></body></html>';

// Synthetic error view derived from the pinned templates/error.html shape.
const ERROR_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Error: Subreddit not found</title></head><body><main>' +
  '<div id="error"><h1>Subreddit not found</h1><p class="error_detail">fixture</p></div>' +
  '</main></body></html>';

beforeAll(async () => {
  server = createServer(handle);
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  // Let any aborted-but-in-flight request land before resetting the shared
  // fixture state, so one case cannot bleed into the next.
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  requests = [];
  socketByPath.clear();
  routes.clear();
});

afterAll(async () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  const closeAll = (server as unknown as { closeAllConnections?: () => void }).closeAllConnections;
  if (typeof closeAll === 'function') closeAll.call(server);
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('exact loopback paths and base normalisation', () => {
  it('requests /r/a+b/hot literally (multireddit plus not %2B) without a base prefix', async () => {
    routes.set('/r/a+b/hot', plain(LISTING_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_posts', { subreddit: 'a+b' });

    expect(result.isError).not.toBe(true);
    expect(requests).toEqual(['/r/a+b/hot']);
    expect(JSON.parse(result.content[0].text).resultCount).toBe(0);
  });

  it('requests /r/demo/wiki/a/b for a documented nested wiki page without a prefix', async () => {
    routes.set('/r/demo/wiki/a/b', plain(WIKI_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_wiki_page', { subreddit: 'demo', page: 'a/b' });

    expect(result.isError).not.toBe(true);
    expect(requests).toEqual(['/r/demo/wiki/a/b']);
    expect(JSON.parse(result.content[0].text)).toEqual({ title: 'a/b', content: '' });
  });

  it('preserves the configured prefix exactly once when the base has a trailing slash', async () => {
    routes.set('/internal/r/a+b/hot', plain(LISTING_HTML));
    routes.set('/internal/r/demo/wiki/a/b', plain(WIKI_HTML));
    routes.set('/internal/r/demo/hot', plain(LISTING_HTML));
    const registry = register(`${origin}/internal/`);

    const posts = await call(registry, 'get_posts', { subreddit: 'a+b' });
    const wiki = await call(registry, 'get_wiki_page', { subreddit: 'demo', page: 'a/b' });
    const listing = await call(registry, 'get_posts', { subreddit: 'demo' });

    expect(posts.isError).not.toBe(true);
    expect(wiki.isError).not.toBe(true);
    expect(listing.isError).not.toBe(true);
    expect(requests).toEqual([
      '/internal/r/a+b/hot',
      '/internal/r/demo/wiki/a/b',
      '/internal/r/demo/hot',
    ]);
  });

  it('keeps every tool inside the configured prefix (front page, user, search)', async () => {
    routes.set('/internal/', plain(LISTING_HTML));
    routes.set('/internal/user/Alice_99', plain(USER_HTML));
    routes.set('/internal/search?q=rust&type=user', plain(LISTING_HTML));
    const registry = register(`${origin}/internal`);

    expect((await call(registry, 'get_front_page', {})).isError).not.toBe(true);
    expect((await call(registry, 'get_user', { username: 'Alice_99' })).isError).not.toBe(true);
    expect(
      (await call(registry, 'search_users', { query: 'rust' })).isError
    ).not.toBe(true);

    expect(requests).toEqual(['/internal/', '/internal/user/Alice_99', '/internal/search?q=rust&type=user']);
    expect(requests.every((path) => path === '/internal' || path.startsWith('/internal/'))).toBe(true);
  });
});

describe('redirect confinement over real loopback', () => {
  it('follows a same-origin, same-prefix redirect and disposes the redirect body', async () => {
    routes.set('/internal/r/demo/hot', reluctant(302, { location: '/internal/r/demo/hot2' }));
    routes.set('/internal/r/demo/hot2', plain(LISTING_HTML));
    const registry = register(`${origin}/internal`);

    const result = await call(registry, 'get_posts', { subreddit: 'demo' });

    expect(result.isError).not.toBe(true);
    expect(requests).toEqual(['/internal/r/demo/hot', '/internal/r/demo/hot2']);
    // The 302 socket carried a deliberately never-ending body; only disposal
    // releases it before this assertion.
    expect(await waitForSocketClose(socketByPath.get('/internal/r/demo/hot'))).toBe(true);
  });

  it('rejects a redirect that leaves the configured prefix without requesting it', async () => {
    routes.set('/internal/r/demo/hot', redirect(302, '/outside/r/demo/hot'));
    routes.set('/outside/r/demo/hot', plain(LISTING_HTML));
    const registry = register(`${origin}/internal`);

    const result = await call(registry, 'get_posts', { subreddit: 'demo' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('outside the configured base path');
    expect(requests).toEqual(['/internal/r/demo/hot']);
  });

  it('rejects a foreign-origin redirect without contacting the foreign origin', async () => {
    const foreign = `${origin.replace('127.0.0.1', 'localhost')}/r/demo/hot`;
    routes.set('/r/demo/hot', redirect(302, foreign));
    const registry = register(origin);

    const result = await call(registry, 'get_posts', { subreddit: 'demo' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('outside the configured origin');
    expect(requests).toEqual(['/r/demo/hot']);
  });

  it('detects a redirect loop', async () => {
    routes.set('/r/loop/hot', redirect(302, '/r/loop2/hot'));
    routes.set('/r/loop2/hot', redirect(302, '/r/loop/hot'));
    const registry = register(origin);

    const result = await call(registry, 'get_posts', { subreddit: 'loop' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Redirect loop');
    expect(requests).toEqual(['/r/loop/hot', '/r/loop2/hot']);
  });

  it('stops at the injected redirect bound', async () => {
    routes.set('/r/hop/hot', redirect(302, '/r/hop/a'));
    routes.set('/r/hop/a', redirect(302, '/r/hop/b'));
    routes.set('/r/hop/b', plain(LISTING_HTML));
    const registry = register(origin, { maxRedirects: 1 });

    const result = await call(registry, 'get_posts', { subreddit: 'hop' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('1-redirect limit');
    expect(requests).toEqual(['/r/hop/hot', '/r/hop/a']);
  });
});

describe('operation budget over real loopback', () => {
  it('times out on stalled headers and releases the socket', async () => {
    routes.set('/r/slow/hot', stallHeaders);
    const registry = register(origin, { timeoutMs: 250 });

    const result = await call(registry, 'get_posts', { subreddit: 'slow' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('250ms timeout');
    expect(await waitForSocketClose(socketByPath.get('/r/slow/hot'))).toBe(true);
  });

  it('times out on a stalled partial body and releases the socket', async () => {
    routes.set('/r/slowbody/hot', stallBody);
    const registry = register(origin, { timeoutMs: 250 });

    const result = await call(registry, 'get_posts', { subreddit: 'slowbody' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('250ms timeout');
    expect(await waitForSocketClose(socketByPath.get('/r/slowbody/hot'))).toBe(true);
  });

  it('caps the DECOMPRESSED body while the transfer is live and releases the socket', async () => {
    const decompressed = '<html><body>' + 'x'.repeat(64 * 1024) + '</body></html>';
    routes.set('/r/big/hot', gzipStream(decompressed));
    const registry = register(origin, { maxBodyBytes: 1024 });

    const result = await call(registry, 'get_posts', { subreddit: 'big' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Response body exceeded 1024 bytes');
    expect(await waitForSocketClose(socketByPath.get('/r/big/hot'))).toBe(true);
  });
});

describe('subreddit-info sibling cleanup over real loopback', () => {
  it('merges both successes on one operation', async () => {
    routes.set('/r/demo/about/sidebar', plain(WIKI_HTML));
    routes.set('/r/demo/hot', plain(LISTING_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_subreddit_info', { subreddit: 'demo' });

    expect(result.isError).not.toBe(true);
    expect(requests.sort()).toEqual(['/r/demo/about/sidebar', '/r/demo/hot']);
  });

  it('settles and disposes a pending sibling when the fast sibling fails (5xx with a reluctant body)', async () => {
    routes.set('/r/sib/about/sidebar', reluctant(500));
    routes.set('/r/sib/hot', stallHeaders);
    const registry = register(origin, { timeoutMs: 4000 });

    const started = Date.now();
    const result = await call(registry, 'get_subreddit_info', { subreddit: 'sib' });
    const elapsed = Date.now() - started;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Redlib returned 500');
    // Bounded by the sibling abort, NOT by the 4 s operation deadline.
    expect(elapsed).toBeLessThan(2000);
    expect(requests.sort()).toEqual(['/r/sib/about/sidebar', '/r/sib/hot']);
    expect(await waitForSocketClose(socketByPath.get('/r/sib/about/sidebar'))).toBe(true);
    expect(await waitForSocketClose(socketByPath.get('/r/sib/hot'))).toBe(true);
  });

  it('settles and disposes the sibling when the delayed failure arrives second', async () => {
    routes.set('/r/sib2/about/sidebar', stallHeaders);
    routes.set('/r/sib2/hot', (req, res) => {
      after(100, () => {
        res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
        res.write('<!DOCTYPE html><html><body>partial');
      });
      void req;
    });
    const registry = register(origin, { timeoutMs: 4000 });

    const started = Date.now();
    const result = await call(registry, 'get_subreddit_info', { subreddit: 'sib2' });
    const elapsed = Date.now() - started;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Redlib returned 503');
    expect(elapsed).toBeLessThan(2000);
    expect(await waitForSocketClose(socketByPath.get('/r/sib2/about/sidebar'))).toBe(true);
    expect(await waitForSocketClose(socketByPath.get('/r/sib2/hot'))).toBe(true);
  });

  it('shares ONE deadline across both requests', async () => {
    routes.set('/r/sib3/about/sidebar', stallHeaders);
    routes.set('/r/sib3/hot', stallHeaders);
    const registry = register(origin, { timeoutMs: 300 });

    const started = Date.now();
    const result = await call(registry, 'get_subreddit_info', { subreddit: 'sib3' });
    const elapsed = Date.now() - started;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('300ms timeout');
    expect(elapsed).toBeLessThan(2000);
    expect(await waitForSocketClose(socketByPath.get('/r/sib3/about/sidebar'))).toBe(true);
    expect(await waitForSocketClose(socketByPath.get('/r/sib3/hot'))).toBe(true);
  });

  it('fails the whole operation when either page is an error view', async () => {
    routes.set('/r/bad/about/sidebar', plain(ERROR_HTML));
    routes.set('/r/bad/hot', plain(LISTING_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_subreddit_info', { subreddit: 'bad' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subreddit not found');
  });
});

describe('R1 subreddit-info pair — first failure acts at every body phase', () => {
  type FailureKind = 'oversize' | 'error-view' | 'unusable';
  type FailingPage = 'sidebar' | 'hot';
  type PeerPhase = 'headers' | 'body';

  const cases: Array<[FailureKind, FailingPage, PeerPhase]> = [];
  for (const failure of ['oversize', 'error-view', 'unusable'] as FailureKind[]) {
    for (const failing of ['sidebar', 'hot'] as FailingPage[]) {
      for (const peerPhase of ['headers', 'body'] as PeerPhase[]) {
        cases.push([failure, failing, peerPhase]);
      }
    }
  }

  const expected: Record<FailureKind, string> = {
    oversize: 'Response body exceeded 1024 bytes',
    'error-view': 'Redlib returned an error page: Subreddit not found',
    unusable: 'missing the expected content column',
  };

  it.each(cases)(
    '%s failure on the %s while the peer is pending at %s returns promptly with the primary error',
    async (failure, failing, peerPhase) => {
      const sidebar = '/r/phase/about/sidebar';
      const hot = '/r/phase/hot';
      const failureRoute = delayed(
        failure === 'oversize'
          ? gzipStream('<html><body>' + 'x'.repeat(64 * 1024) + '</body></html>')
          : failure === 'error-view'
            ? plain(ERROR_HTML)
            : plain('<!DOCTYPE html><html><body><main></main></body></html>')
      );
      routes.set(failing === 'sidebar' ? sidebar : hot, failureRoute);
      routes.set(
        failing === 'sidebar' ? hot : sidebar,
        peerPhase === 'headers' ? stallHeaders : stallBody
      );
      const registry = register(origin, { timeoutMs: 2500, maxBodyBytes: 1024 });

      const started = Date.now();
      const result = await call(registry, 'get_subreddit_info', { subreddit: 'phase' });
      const elapsed = Date.now() - started;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(expected[failure]);
      expect(result.content[0].text).not.toContain('2500ms timeout');
      expect(result.content[0].text).not.toContain('Request was aborted');
      // Promptly, well before the injected 2500 ms shared deadline.
      expect(elapsed).toBeLessThan(1500);
      expect(requests.sort()).toEqual([sidebar, hot].sort());
      // A fully consumed plain body leaves nothing to dispose; a streamed
      // oversize failure must release its live socket too. The pending peer
      // must always be released by the abort.
      if (failure === 'oversize') {
        expect(await waitForSocketClose(socketByPath.get(failing === 'sidebar' ? sidebar : hot))).toBe(true);
      }
      expect(await waitForSocketClose(socketByPath.get(failing === 'sidebar' ? hot : sidebar))).toBe(true);
    }
  );
});

describe('usable-page validation over real loopback', () => {
  it('keeps a genuinely empty listing and an empty wiki body successful', async () => {
    routes.set('/r/empty/hot', plain(LISTING_HTML));
    routes.set('/r/empty/wiki/index', plain(WIKI_HTML));
    const registry = register(origin);

    const listing = await call(registry, 'get_posts', { subreddit: 'empty' });
    const wiki = await call(registry, 'get_wiki_page', { subreddit: 'empty' });

    expect(listing.isError).not.toBe(true);
    expect(JSON.parse(listing.content[0].text).resultCount).toBe(0);
    expect(wiki.isError).not.toBe(true);
    expect(JSON.parse(wiki.content[0].text).content).toBe('');
  });

  it('fails a recognised error view served with HTTP 200', async () => {
    routes.set('/r/gone/hot', plain(ERROR_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_posts', { subreddit: 'gone' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error fetching posts:');
    expect(result.content[0].text).toContain('Redlib returned an error page: Subreddit not found');
  });

  it('fails an unusable page without the expected content column', async () => {
    routes.set('/r/blank/hot', plain('<!DOCTYPE html><html><body><main></main></body></html>'));
    const registry = register(origin);

    const result = await call(registry, 'get_posts', { subreddit: 'blank' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing the expected content column');
  });

  it('fails a wiki page that lacks the wiki container', async () => {
    routes.set('/r/nowiki/wiki/index', plain(LISTING_HTML));
    const registry = register(origin);

    const result = await call(registry, 'get_wiki_page', { subreddit: 'nowiki' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing the expected wiki container');
  });
});

describe('real SDK boundary — comment-sort rejection before HTTP', () => {
  it('rejects unsupported sorts at the SDK with zero requests and accepts a supported sort', async () => {
    routes.set('/search?q=x&type=comment&sort=top&limit=25', plain(LISTING_HTML));
    const transport = new RawClientTransport();
    const server = new McpServer({ name: 'sdk-boundary-test', version: '1' });
    registerTools(server, { baseUrl: origin, publicBaseUrl: 'https://www.reddit.com' });
    await server.connect(transport);
    let nextId = 0;
    const request = async (method: string, params: unknown) => {
      const id = ++nextId;
      transport.sendToServer({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
      return transport.replyFor(id);
    };
    try {
      const init = await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'sdk-boundary-test', version: '1' },
      });
      expect(init.result).toBeDefined();
      transport.sendToServer({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);

      for (const sort of ['hot', 'comments']) {
        const reply = await request('tools/call', { name: 'search_comments', arguments: { query: 'x', sort } });
        expect(reply.result.isError).toBe(true);
        // Rejection must precede dispatch: no HTTP request may be made.
        expect(requests).toEqual([]);
        // The SDK's own validation diagnostic, not a handler error envelope.
        expect(reply.result.content[0].text).toContain('Input validation error');
      }

      const accepted = await request('tools/call', { name: 'search_comments', arguments: { query: 'x', sort: 'top' } });
      expect(accepted.result.isError).not.toBe(true);
      expect(requests).toEqual(['/search?q=x&type=comment&sort=top&limit=25']);
    } finally {
      await server.close();
    }
  });
});
