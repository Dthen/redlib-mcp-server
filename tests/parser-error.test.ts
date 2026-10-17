import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, Headers } from 'node-fetch';

/**
 * Isolated parser-stage exception tests for get_post.
 *
 * Unlike the resolver-rejection tests (where parsePostReference throws before
 * any fetch), these tests mock ONLY parsePostDetails to throw a sentinel
 * error AFTER a successful fetch, proving the handler catches it and returns
 * the standard error envelope (isError: true, "Error fetching post: <sentinel>")
 * rather than leaking a raw exception or returning partial post JSON.
 *
 * This file is isolated from tools.test.ts so the parsers.js ESM mock does
 * not leak into the real-parser tests.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const REDLIB_BASE = 'http://redlib.test:8080';
process.env.REDLIB_URL = REDLIB_BASE;
process.env.REDLIB_PUBLIC_URL = 'https://www.reddit.com';

const POST_DETAIL_HTML = readFileSync(join(__dirname, 'fixtures', 'post-detail.html'), 'utf-8');
const SENTINEL_MESSAGE = 'PARSER_SENTINEL_ERROR_42';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

interface UpstreamRoute {
  status: number;
  body?: string;
  location?: string;
}

let upstream: Record<string, UpstreamRoute> = {};
let requestedUrls: string[] = [];

function makeResponse(status: number, body: string, location?: string): Response {
  const headers = new Headers();
  if (location) headers.set('location', location);
  return new Response(body, { status, headers });
}

async function fetchMock(input: unknown, _init: any = {}): Promise<Response> {
  const url = String(input);
  requestedUrls.push(url);
  const route = upstream[url] ?? upstream['*'];
  if (!route) return makeResponse(404, '');
  return makeResponse(route.status, route.body ?? '', route.location);
}

// Mock node-fetch and parsers.js (ONLY parsePostDetails overridden).
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

const realParsers = await import('../src/parsers.js');
jest.unstable_mockModule('../src/parsers.js', () => ({
  ...realParsers,
  parsePostDetails: () => {
    throw new Error(SENTINEL_MESSAGE);
  },
}));

type ToolCallback = (args: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: any;
  annotations?: Record<string, unknown>;
}

let registry: Record<string, { config: ToolConfig; callback: ToolCallback }> = {};
let getPost: ToolCallback;
let getPostSchema: any;

beforeAll(async () => {
  const { registerTools } = await import('../src/tools.js');
  const fakeServer = {
    registerTool(name: string, config: ToolConfig, callback: ToolCallback) {
      registry[name] = { config, callback };
      return undefined;
    },
  };
  registerTools(fakeServer as any);
  getPost = registry['get_post'].callback;
  getPostSchema = registry['get_post'].config.inputSchema;
});

beforeEach(() => {
  requestedUrls = [];
  upstream = {};
});

afterAll(() => {
  delete process.env.REDLIB_URL;
  delete process.env.REDLIB_PUBLIC_URL;
});

// ---------------------------------------------------------------------------
// Parser-stage exception tests
// ---------------------------------------------------------------------------

describe('get_post handler — parser-stage exception (parsePostDetails throws)', () => {
  it('returns error envelope when parsePostDetails throws after successful fetch', async () => {
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: POST_DETAIL_HTML },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    // The fetch happened (resolver succeeded)
    expect(requestedUrls).toEqual(['http://redlib.test:8080/comments/1x7hpcl']);

    // Handler caught the sentinel and returned the standard error envelope
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error fetching post: ${SENTINEL_MESSAGE}`);
  });

  it('does not return partial post JSON when parser throws', async () => {
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: POST_DETAIL_HTML },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    // The text is NOT valid JSON — it's the error envelope
    expect(() => JSON.parse(result.content[0].text)).toThrow();
    expect(result.content[0].text).toContain('Error fetching post:');
  });

  it('error message contains the exact sentinel from the parser', async () => {
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: POST_DETAIL_HTML },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.content[0].text).toContain(SENTINEL_MESSAGE);
  });

  it('still catches parser throw when subreddit hint is used', async () => {
    upstream = {
      'http://redlib.test:8080/r/webscraping/comments/1x7hpcl': { status: 200, body: POST_DETAIL_HTML },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl', subreddit: 'webscraping' });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual(['http://redlib.test:8080/r/webscraping/comments/1x7hpcl']);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error fetching post: ${SENTINEL_MESSAGE}`);
  });
});
