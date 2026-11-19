import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, Headers } from 'node-fetch';
import { z } from 'zod';

/**
 * get_post post-reference resolution — real-handler regression tests.
 *
 * These tests drive the REAL `get_post` callback registered by
 * `registerTools`, through mocked `node-fetch`. They verify:
 *  - Tool registration (all 10 tools, schema shape)
 *  - Handler behavior for legacy and new reference forms
 *  - Validity guard (title / post ID / expected ID)
 *  - Error envelope and zero-fetch on invalid input
 *
 * The mock returns REAL node-fetch Response/Headers objects so the
 * helper's manual redirect handling (headers.get('location')) and
 * body disposal are exercised correctly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// src/tools.ts reads REDLIB_URL at module-evaluation time; pin it before the
// dynamic import so the requested-route assertions are deterministic.
const REDLIB_BASE = 'http://redlib.test:8080';
process.env.REDLIB_URL = REDLIB_BASE;
process.env.REDLIB_PUBLIC_URL = 'https://www.reddit.com';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const POST_DETAIL_HTML = readFileSync(join(__dirname, 'fixtures', 'post-detail.html'), 'utf-8');
// Synthetic comment-shaped page derived from the pinned search.html comment branch.
const COMMENTS_HTML = readFileSync(join(__dirname, 'fixtures', 'comment-search-comments.html'), 'utf-8');
// Synthetic current people-card page derived from the pinned search.html people branch.
const PEOPLE_HTML = readFileSync(join(__dirname, 'fixtures', 'people-search-cards.html'), 'utf-8');
// Legacy user-result markup, unchanged.
const LEGACY_USERS_HTML = readFileSync(join(__dirname, 'fixtures', 'user-search.html'), 'utf-8');
// The old 25-post capture that contains no comment results at all.
const POST_SHAPED_HTML = readFileSync(join(__dirname, 'fixtures', 'comment-search.html'), 'utf-8');
// Existing legacy fixtures reused as positive neighbours for the non-post paths.
const POST_LIST_HTML = readFileSync(join(__dirname, 'fixtures', 'post-list.html'), 'utf-8');
const SUBREDDIT_SEARCH_HTML = readFileSync(join(__dirname, 'fixtures', 'subreddit-search.html'), 'utf-8');
const USER_OVERVIEW_HTML = readFileSync(join(__dirname, 'fixtures', 'user-overview.html'), 'utf-8');
const FRONTPAGE_HTML = readFileSync(join(__dirname, 'fixtures', 'frontpage-popular.html'), 'utf-8');
const WIKI_FIXTURE_HTML = readFileSync(join(__dirname, 'fixtures', 'wiki-page.html'), 'utf-8');
const SUBREDDIT_INFO_HTML = readFileSync(join(__dirname, 'fixtures', 'subreddit-info.html'), 'utf-8');
const SUBREDDIT_MAIN_HTML = readFileSync(join(__dirname, 'fixtures', 'subreddit-main.html'), 'utf-8');

/** A valid, genuinely empty page: the pinned templates still render #column_one. */
const EMPTY_LISTING_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Empty</title></head><body><main>' +
  '<div id="column_one"><div id="posts"></div></div></main></body></html>';

/** A valid wiki page with an empty body (#column_one + #wiki are always rendered). */
const EMPTY_WIKI_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>index - demo</title></head><body><main>' +
  '<div class="panel" id="column_one"><div id="wiki"><div class="md wiki"></div></div></div>' +
  '</main></body></html>';

/** A valid user page with empty collections. */
const EMPTY_USER_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>spez (u/spez) - Redlib</title></head><body><main>' +
  '<div id="column_one"><div id="posts"></div></div>' +
  '<aside><div class="panel" id="user"><h1 id="user_title">spez</h1><p id="user_name">u/spez</p>' +
  '<div id="user_description"></div><div id="user_details"></div></div></aside>' +
  '</main></body></html>';

/** Synthetic error view derived from the pinned templates/error.html shape. */
const ERROR_VIEW_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Error: Subreddit not found</title></head><body><main>' +
  '<div id="error"><h1>Subreddit not found</h1></div></main></body></html>';

/**
 * Build minimal post HTML that parsePostDetails can extract.
 * All fields default to a valid post; override to test edge cases.
 */
function makePostHtml(opts: {
  id?: string;
  title?: string;
  author?: string;
  subreddit?: string;
  body?: string;
  score?: number | null;
  scoreHidden?: boolean;
  comments?: string;
  media?: string;
  omitPostIdAttr?: boolean;
} = {}): string {
  const {
    id = '1x7hpcl',
    title = 'Test Post Title',
    author = 'testuser',
    subreddit = 'testsubreddit',
    body = 'This is the post body.',
    score = 42,
    scoreHidden = false,
    comments = '',
    media = '',
    omitPostIdAttr = false,
  } = opts;

  const scoreHtml = scoreHidden
    ? '<span class="post_score" title="hidden">[score hidden]</span>'
    : score !== null
      ? `<span class="post_score">${score}</span>`
      : '';

  const postIdAttr = omitPostIdAttr ? '' : `id="${id}"`;

  return `<!DOCTYPE html>
<html lang="en">
<head><title>${title}</title></head>
<body>
<main>
  <div class="post" ${postIdAttr}>
    <div class="post_header">
      <h1 class="post_title"><a href="/r/${subreddit}/comments/${id}/">${title}</a></h1>
      <span class="post_author">${author}</span>
      <span class="post_subreddit">r/${subreddit}</span>
    </div>
    <div class="post_body">${body}</div>
    ${scoreHtml}
    ${media}
  </div>
  ${comments}
</main>
</body>
</html>`;
}

/** Build a single comment HTML block. */
function makeCommentHtml(id: string, author = 'commenter', text = 'Comment text', score = 5): string {
  return `<div class="comment" id="t1_${id}">
  <div class="comment_data">
    <a class="created" href="/r/testsubreddit/comments/1x7hpcl/#${id}">2 hours ago</a>
  </div>
  <span class="comment_author">${author}</span>
  <div class="comment_body"><div class="md">${text}</div></div>
  <span class="comment_score">${score}</span>
</div>`;
}

/** Build HTML with N top-level comments. */
function makeCommentsHtml(count: number): string {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += makeCommentHtml(`c${i.toString(36).padStart(3, '0')}`, `user${i}`, `Comment ${i}`, i);
  }
  return html;
}

// HTTP-200 page carrying no parseable post identity.
const EMPTY_PAGE_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Redlib</title></head><body><main></main></body></html>';

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

// Register the module mock before src/tools.ts is dynamically imported.
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

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
let searchComments: ToolCallback;
let searchUsers: ToolCallback;
let searchCommentsSchema: any;
let toolsModule: typeof import('../src/tools.js');
let requestModule: typeof import('../src/request.js');

function makeRegistry(runtime: import('../src/tools.js').ToolRuntime) {
  const tools: Record<string, { config: ToolConfig; callback: ToolCallback }> = {};
  const fakeServer = {
    registerTool(name: string, config: ToolConfig, callback: ToolCallback) {
      tools[name] = { config, callback };
      return undefined;
    },
  };
  toolsModule.registerTools(fakeServer as any, runtime);
  return tools;
}

beforeAll(async () => {
  toolsModule = await import('../src/tools.js');
  requestModule = await import('../src/request.js');
  const { registerTools } = toolsModule;
  const fakeServer = {
    registerTool(name: string, config: ToolConfig, callback: ToolCallback) {
      registry[name] = { config, callback };
      return undefined;
    },
  };
  registerTools(fakeServer as any);
  getPost = registry['get_post'].callback;
  getPostSchema = registry['get_post'].config.inputSchema;
  searchComments = registry['search_comments'].callback;
  searchUsers = registry['search_users'].callback;
  searchCommentsSchema = registry['search_comments'].config.inputSchema;
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
// Schema tests
// ---------------------------------------------------------------------------

describe('tool registration', () => {
  it('registers all 10 tools', () => {
    expect(Object.keys(registry).sort()).toEqual([
      'get_front_page',
      'get_post',
      'get_posts',
      'get_subreddit_info',
      'get_user',
      'get_wiki_page',
      'search_comments',
      'search_posts',
      'search_subreddits',
      'search_users',
    ]);
  });

  it('get_post has correct schema shape', () => {
    expect(getPostSchema).toBeDefined();
    const shape = getPostSchema.shape;
    expect(shape).toBeDefined();
    expect(shape.postId).toBeDefined();
    expect(shape.subreddit).toBeDefined();
    expect(shape.comment_sort).toBeDefined();
    expect(shape.comment_limit).toBeDefined();
  });

  it('get_post postId is required (fails on empty/missing)', () => {
    expect(() => getPostSchema.parse({})).toThrow();
    expect(() => getPostSchema.parse({ postId: '' })).toThrow();
  });

  it('get_post subreddit is optional', () => {
    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    expect(parsed.subreddit).toBeUndefined();
  });

  it('get_post comment_sort is optional', () => {
    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    expect(parsed.comment_sort).toBeUndefined();
  });

  it('get_post comment_limit defaults to 10', () => {
    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    expect(parsed.comment_limit).toBe(10);
  });

  it('get_post comment_limit accepts explicit values', () => {
    const parsed = getPostSchema.parse({ postId: '1x7hpcl', comment_limit: 25 });
    expect(parsed.comment_limit).toBe(25);
  });

  it('other tool schemas are unchanged (spot-check required fields)', () => {
    // search_posts: query required
    expect(() => registry['search_posts'].config.inputSchema.parse({})).toThrow();
    // get_posts: subreddit required
    expect(() => registry['get_posts'].config.inputSchema.parse({})).toThrow();
    // search_subreddits: query required
    expect(() => registry['search_subreddits'].config.inputSchema.parse({})).toThrow();
    // get_subreddit_info: subreddit required
    expect(() => registry['get_subreddit_info'].config.inputSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler tests — reference forms
// ---------------------------------------------------------------------------

describe('get_post handler — reference forms', () => {
  it('legacy form: subreddit + postId requests /r/<sub>/comments/<id>', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    upstream = {
      'http://redlib.test:8080/r/webscraping/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ subreddit: 'webscraping', postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual(['http://redlib.test:8080/r/webscraping/comments/1x7hpcl']);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.title).toBe('Test Post Title');
  });

  it('bare ID without hint requests /comments/<id>', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual(['http://redlib.test:8080/comments/1x7hpcl']);
    expect(result.isError).not.toBe(true);
  });

  it('full URL with subreddit scope resolves to scoped route', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    upstream = {
      'http://redlib.test:8080/r/webscraping/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({
      postId: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl/',
    });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual(['http://redlib.test:8080/r/webscraping/comments/1x7hpcl']);
    expect(result.isError).not.toBe(true);
  });

  it('share reference with hint requests share route and follows redirect', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    const sharePath = '/r/webscraping/s/yf4R7bbaHP';
    const canonicalPath = '/r/webscraping/comments/1x7hpcl';
    upstream = {
      [`http://redlib.test:8080${sharePath}`]: { status: 302, location: canonicalPath },
      [`http://redlib.test:8080${canonicalPath}`]: { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ subreddit: 'webscraping', postId: 's/yf4R7bbaHP' });
    const result = await getPost(parsed);

    expect(requestedUrls[0]).toBe(`http://redlib.test:8080${sharePath}`);
    expect(requestedUrls).toContain(`http://redlib.test:8080${canonicalPath}`);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
  });

  it('scoped share route r/<sub>/s/<token> requests the share route', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    const sharePath = '/r/webscraping/s/yf4R7bbaHP';
    const canonicalPath = '/r/webscraping/comments/1x7hpcl';
    upstream = {
      [`http://redlib.test:8080${sharePath}`]: { status: 302, location: canonicalPath },
      [`http://redlib.test:8080${canonicalPath}`]: { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: 'r/webscraping/s/yf4R7bbaHP' });
    const result = await getPost(parsed);

    expect(requestedUrls[0]).toBe(`http://redlib.test:8080${sharePath}`);
    expect(result.isError).not.toBe(true);
  });

  it('full share URL without subreddit resolves and fetches the share route', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    const sharePath = '/r/webscraping/s/yf4R7bbaHP';
    const canonicalPath = '/r/webscraping/comments/1x7hpcl';
    upstream = {
      [`http://redlib.test:8080${sharePath}`]: { status: 302, location: canonicalPath },
      [`http://redlib.test:8080${canonicalPath}`]: { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({
      postId: 'https://www.reddit.com/r/webscraping/s/yf4R7bbaHP',
    });
    const result = await getPost(parsed);

    expect(requestedUrls[0]).toBe(`http://redlib.test:8080${sharePath}`);
    expect(requestedUrls).toContain(`http://redlib.test:8080${canonicalPath}`);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
  });

  it('explicit comment_sort propagates as URL sort query', async () => {
    const html = makePostHtml({ id: '1x7hpcl', comments: makeCommentsHtml(3) });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl?sort=new': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl', comment_sort: 'new' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    expect(requestedUrls[0]).toBe('http://redlib.test:8080/comments/1x7hpcl?sort=new');
  });

  it('explicit comment_sort overrides URL sort parameter', async () => {
    const html = makePostHtml({ id: '1x7hpcl', comments: makeCommentsHtml(3) });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl?sort=new': { status: 200, body: html },
    };

    // URL carries ?sort=old but handler is called with comment_sort=new
    const parsed = getPostSchema.parse({
      postId: 'https://www.reddit.com/comments/1x7hpcl/?sort=old',
      comment_sort: 'new',
    });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    expect(requestedUrls[0]).toBe('http://redlib.test:8080/comments/1x7hpcl?sort=new');
  });
});

// ---------------------------------------------------------------------------
// Handler tests — validity guard
// ---------------------------------------------------------------------------

describe('get_post handler — validity guard', () => {
  it('returns isError for an HTTP-200 empty detail page (no title)', async () => {
    upstream = { '*': { status: 200, body: EMPTY_PAGE_HTML } };

    const parsed = getPostSchema.parse({ subreddit: 'webscraping', postId: 's/yf4R7bbaHP' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
  });

  it('returns isError when HTML has no post ID', async () => {
    const html = makePostHtml({ id: '1x7hpcl', omitPostIdAttr: true });
    // Remove the id from the href too so parser can't extract it
    const noIdHtml = html.replace(/\/comments\/1x7hpcl\//g, '/comments//');
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: noIdHtml },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error fetching post:');
  });

  it('returns isError when HTML has empty title', async () => {
    const html = makePostHtml({ id: '1x7hpcl', title: '' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No valid post found');
  });

  it('returns isError when returned ID does not match expected ID', async () => {
    const html = makePostHtml({ id: 'abc123' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Post ID mismatch');
  });

  it('accepts ID match case-insensitively', async () => {
    const html = makePostHtml({ id: '1X7HPCL' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler tests — error paths
// ---------------------------------------------------------------------------

describe('get_post handler — error paths', () => {
  it('returns isError for upstream HTTP error (500)', async () => {
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 500, body: 'Internal Server Error' },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error fetching post:');
    expect(result.content[0].text).toContain('500');
  });

  it('returns isError for resolver error (invalid reference) with zero fetch', async () => {
    // A valid-length string that fails reference parsing
    const parsed = getPostSchema.parse({ postId: 'not-a-valid-ref' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error fetching post:');
    expect(requestedUrls).toEqual([]);
  });

  it('returns isError for share fragment without subreddit (missing context)', async () => {
    const parsed = getPostSchema.parse({ postId: 's/yf4R7bbaHP' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('share reference requires subreddit');
    expect(requestedUrls).toEqual([]);
  });

  it('returns isError for unsupported reference (resolver rejection) with zero fetch', async () => {
    // A valid-length string that fails reference parsing at the resolver stage
    // (parsePostDetails is NOT reached — no fetch occurs).
    const parsed = getPostSchema.parse({ postId: 'not-a-valid-ref' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error fetching post:');
    expect(requestedUrls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Handler tests — valid edge cases (must succeed with title + ID)
// ---------------------------------------------------------------------------

describe('get_post handler — valid edge cases', () => {
  it('succeeds with deleted author', async () => {
    const html = makePostHtml({ id: '1x7hpcl', author: '[deleted]' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.author).toBe('[deleted]');
  });

  it('succeeds with empty body', async () => {
    const html = makePostHtml({ id: '1x7hpcl', body: '' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.body).toBe('');
  });

  it('succeeds with zero comments', async () => {
    const html = makePostHtml({ id: '1x7hpcl', comments: '' });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.comments).toEqual([]);
    expect(payload.commentCount).toBe(0);
  });

  it('succeeds with hidden score', async () => {
    const html = makePostHtml({ id: '1x7hpcl', scoreHidden: true });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.score).toBeNull();
    expect(payload.score_hidden).toBe(true);
  });

  it('succeeds with image-only post (media present)', async () => {
    const media = '<figure><img src="/media/image.jpg"><a href="/media/image.jpg">image</a></figure>';
    const html = makePostHtml({ id: '1x7hpcl', body: '', media });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(payload.media).toBeDefined();
    expect(payload.media.length).toBeGreaterThan(0);
  });

  it('succeeds with real fixture (post-detail.html)', async () => {
    upstream = {
      'http://redlib.test:8080/comments/t93ec3': { status: 200, body: POST_DETAIL_HTML },
    };

    const parsed = getPostSchema.parse({ postId: 't93ec3' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('t93ec3');
    expect(typeof payload.title).toBe('string');
    expect(payload.title.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Handler tests — comment limit semantics
// ---------------------------------------------------------------------------

describe('get_post handler — comment limit', () => {
  it('applies default comment limit of 10', async () => {
    const comments = makeCommentsHtml(15);
    const html = makePostHtml({ id: '1x7hpcl', comments });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl' });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.comments.length).toBe(10);
    expect(payload.commentCount).toBe(15);
  });

  it('applies explicit comment limit', async () => {
    const comments = makeCommentsHtml(15);
    const html = makePostHtml({ id: '1x7hpcl', comments });
    upstream = {
      'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html },
    };

    const parsed = getPostSchema.parse({ postId: '1x7hpcl', comment_limit: 5 });
    const result = await getPost(parsed);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.comments.length).toBe(5);
    expect(payload.commentCount).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Original Task 1 regressions (must now pass)
// ---------------------------------------------------------------------------

describe('get_post post-reference resolution (Task 1 regressions)', () => {
  const HISTORICAL_ARGS = { subreddit: 'webscraping', postId: 's/yf4R7bbaHP' };
  const SHARE_PATH = '/r/webscraping/s/yf4R7bbaHP';
  // parsePostReference normalizes the canonical route to /r/<sub>/comments/<id>
  const CANONICAL_PATH = '/r/webscraping/comments/1x7hpcl';
  const WRONG_PATH = '/r/webscraping/comments/s/yf4R7bbaHP';
  const SHARE_URL = `http://redlib.test:8080${SHARE_PATH}`;
  const CANONICAL_URL = `http://redlib.test:8080${CANONICAL_PATH}`;
  const WRONG_URL = `http://redlib.test:8080${WRONG_PATH}`;

  it('resolves a share-link post reference through the requested share route', async () => {
    const html = makePostHtml({ id: '1x7hpcl' });
    upstream = {
      [SHARE_URL]: { status: 302, location: CANONICAL_PATH },
      [CANONICAL_URL]: { status: 200, body: html },
      [WRONG_URL]: { status: 200, body: EMPTY_PAGE_HTML },
    };

    const parsed = getPostSchema.parse(HISTORICAL_ARGS);
    const result = await getPost(parsed);

    expect(requestedUrls[0]).toBe(SHARE_URL);
    expect(requestedUrls).not.toContain(WRONG_URL);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1x7hpcl');
    expect(typeof payload.title).toBe('string');
    expect(payload.title.length).toBeGreaterThan(0);

    expect(Array.isArray(payload.comments)).toBe(true);
    expect(payload.comments.length).toBeLessThanOrEqual(10);
    expect(typeof payload.commentCount).toBe('number');
  });

  it('returns isError for an HTTP-200 empty detail page', async () => {
    upstream = { '*': { status: 200, body: EMPTY_PAGE_HTML } };

    const parsed = getPostSchema.parse(HISTORICAL_ARGS);
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler tests — profile post fallback (bare ID + username hint)
// ---------------------------------------------------------------------------

describe('get_post handler — profile post fallback (bare ID + hint)', () => {
  const PROFILE_POST_HTML = readFileSync(join(__dirname, 'fixtures', 'profile-post-excerpt.html'), 'utf-8');

  it('falls back to /user/ when /r/ returns 404 (real profile excerpt)', async () => {
    const scopedPath = '/r/spez/comments/1u7hraf';
    const fallbackPath = '/user/spez/comments/1u7hraf';
    upstream = {
      [`http://redlib.test:8080${scopedPath}`]: { status: 404, body: '' },
      [`http://redlib.test:8080${fallbackPath}`]: { status: 200, body: PROFILE_POST_HTML },
    };

    const parsed = getPostSchema.parse({ postId: '1u7hraf', subreddit: 'spez' });
    const result = await getPost(parsed);

    expect(requestedUrls[0]).toBe(`http://redlib.test:8080${scopedPath}`);
    expect(requestedUrls[1]).toBe(`http://redlib.test:8080${fallbackPath}`);
    expect(requestedUrls).toHaveLength(2);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1u7hraf');
    expect(payload.title).toBe('21 years of Reddit');
  });

  it('explicit /user scoped path succeeds without hint', async () => {
    const userPath = '/user/spez/comments/1u7hraf';
    upstream = {
      [`http://redlib.test:8080${userPath}`]: { status: 200, body: PROFILE_POST_HTML },
    };

    const parsed = getPostSchema.parse({ postId: 'user/spez/comments/1u7hraf' });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual([`http://redlib.test:8080${userPath}`]);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1u7hraf');
    expect(payload.title).toBe('21 years of Reddit');
  });

  it('explicit /u scoped path succeeds without hint', async () => {
    const userPath = '/user/spez/comments/1u7hraf';
    upstream = {
      [`http://redlib.test:8080${userPath}`]: { status: 200, body: PROFILE_POST_HTML },
    };

    const parsed = getPostSchema.parse({ postId: 'u/spez/comments/1u7hraf' });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual([`http://redlib.test:8080${userPath}`]);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1u7hraf');
    expect(payload.title).toBe('21 years of Reddit');
  });

  it('explicit /user full URL succeeds without hint', async () => {
    const userPath = '/user/spez/comments/1u7hraf';
    upstream = {
      [`http://redlib.test:8080${userPath}`]: { status: 200, body: PROFILE_POST_HTML },
    };

    const parsed = getPostSchema.parse({
      postId: 'https://www.reddit.com/user/spez/comments/1u7hraf/21_years_of_reddit/',
    });
    const result = await getPost(parsed);

    expect(requestedUrls).toEqual([`http://redlib.test:8080${userPath}`]);
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('1u7hraf');
    expect(payload.title).toBe('21 years of Reddit');
  });
});

// ---------------------------------------------------------------------------
// Invalid input — zero fetch
// ---------------------------------------------------------------------------

describe('get_post handler — invalid input (zero fetch)', () => {
  it('schema rejects empty postId before handler is called', () => {
    expect(() => getPostSchema.parse({ postId: '' })).toThrow();
  });

  it('whitespace-only postId returns error without fetching', async () => {
    const parsed = getPostSchema.parse({ postId: '   ' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(requestedUrls).toEqual([]);
  });

  it('unsupported reference returns error without fetching', async () => {
    const parsed = getPostSchema.parse({ postId: 'https://evil.com/attack' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(requestedUrls).toEqual([]);
  });

  it('share fragment without hint returns error without fetching', async () => {
    const parsed = getPostSchema.parse({ postId: 's/yf4R7bbaHP' });
    const result = await getPost(parsed);

    expect(result.isError).toBe(true);
    expect(requestedUrls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search_comments / search_users handlers — real registered callbacks,
// mocked HTTP only. Arguments go through the tool's own input schema so the
// SDK defaults are applied exactly as dispatch would apply them.
// ---------------------------------------------------------------------------

describe('search_comments handler', () => {
  it('returns parsed comment results (never posts) for a comment-shaped page', async () => {
    const url = 'http://redlib.test:8080/search?q=borrow&type=comment&sort=relevance&limit=25';
    upstream = { [url]: { status: 200, body: COMMENTS_HTML } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'borrow' }));

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.query).toBe('borrow');
    expect(payload.sort).toBe('relevance');
    expect(payload.resultCount).toBe(3);
    expect(payload.comments.map((c: any) => c.author)).toEqual(['u/ferris_fan', 'u/quiet_quokka', 'u/spez']);
    expect(payload.comments[0]).toMatchObject({
      text: 'The borrow checker is right, and the error message says why.',
      score: 94,
      linkTitle: 'Borrow checker tales',
      permalink: 'https://www.reddit.com/r/rust/comments/1abc23/borrow_checker_tales/kk91x2z/',
      parent_permalink: 'https://www.reddit.com/r/rust/comments/1abc23/',
      subreddit: 'rust',
    });
    expect(requestedUrls).toEqual([url]);
  });

  it('returns an empty success for a legacy post-shaped comment-search page', async () => {
    const url = 'http://redlib.test:8080/search?q=posts&type=comment&sort=relevance&limit=25';
    upstream = { [url]: { status: 200, body: POST_SHAPED_HTML } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'posts' }));

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      query: 'posts',
      sort: 'relevance',
      resultCount: 0,
      comments: [],
    });
    expect(requestedUrls).toEqual([url]);
  });

  it('keeps a valid page with no results successful and empty', async () => {
    const url = 'http://redlib.test:8080/search?q=nothing&type=comment&sort=relevance&limit=25';
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'nothing' }));

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      query: 'nothing',
      sort: 'relevance',
      resultCount: 0,
      comments: [],
    });
  });

  it('uses the pinned subreddit route, restrict_sr alias and the chosen comment sort', async () => {
    const url = 'http://redlib.test:8080/r/rust/search?q=borrow&type=comment&restrict_sr=on&sort=top&limit=25';
    upstream = { [url]: { status: 200, body: COMMENTS_HTML } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'borrow', subreddit: 'rust', sort: 'top' }));

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.sort).toBe('top');
    expect(payload.resultCount).toBe(3);
    expect(requestedUrls).toEqual([url]);
  });

  it('applies the client-side limit to the returned collection', async () => {
    const url = 'http://redlib.test:8080/search?q=borrow&type=comment&sort=relevance&limit=2';
    upstream = { [url]: { status: 200, body: COMMENTS_HTML } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'borrow', limit: 2 }));

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.resultCount).toBe(2);
    expect(payload.comments).toHaveLength(2);
  });

  it('surfaces an upstream failure as an error response', async () => {
    const url = 'http://redlib.test:8080/search?q=down&type=comment&sort=relevance&limit=25';
    upstream = { [url]: { status: 503, body: '' } };

    const result = await searchComments(searchCommentsSchema.parse({ query: 'down' }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('503');
  });
});

describe('search_comments schema — pinned comment-tab sorts only', () => {
  it('accepts relevance, top and new, defaulting to relevance', () => {
    for (const sort of ['relevance', 'top', 'new']) {
      expect(searchCommentsSchema.parse({ query: 'x', sort }).sort).toBe(sort);
    }
    expect(searchCommentsSchema.parse({ query: 'x' }).sort).toBe('relevance');
  });

  it('rejects hot and comments before any handler or fetch can run', () => {
    for (const sort of ['hot', 'comments']) {
      expect(() => searchCommentsSchema.parse({ query: 'x', sort })).toThrow();
    }
    expect(requestedUrls).toEqual([]);
  });

  it('leaves the post-search sort choices unchanged', () => {
    const postSchema = registry['search_posts'].config.inputSchema;
    for (const sort of ['relevance', 'hot', 'top', 'new', 'comments']) {
      expect(postSchema.parse({ query: 'x', sort }).sort).toBe(sort);
    }
  });
});

describe('search_users handler', () => {
  it('returns current people cards without inventing descriptions', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=user';
    upstream = { [url]: { status: 200, body: PEOPLE_HTML } };

    const result = await searchUsers(registry['search_users'].config.inputSchema.parse({ query: 'rust' }));

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      query: 'rust',
      resultCount: 2,
      users: [{ username: 'Alice_99' }, { username: 'Bob-42' }],
    });
    expect(requestedUrls).toEqual([url]);
  });

  it('keeps the unchanged legacy user results as a positive neighbour', async () => {
    const url = 'http://redlib.test:8080/search?q=legacy&type=user';
    upstream = { [url]: { status: 200, body: LEGACY_USERS_HTML } };

    const result = await searchUsers(registry['search_users'].config.inputSchema.parse({ query: 'legacy' }));

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.resultCount).toBe(4);
    expect(payload.users[0]).toEqual({
      username: 'testuser1',
      description: 'Just a test user who loves testing things.',
    });
    expect(payload.users.map((u: any) => u.username)).toEqual(['testuser1', 'test_dev', 'TestBot42', 'TestingTheTester']);
  });
});

// ---------------------------------------------------------------------------
// Batch D: non-post handler paths — success / empty / error over mocked HTTP.
// Arguments pass through each tool's own input schema, so SDK defaults apply.
// ---------------------------------------------------------------------------

function invoke(name: string, args: unknown, reg = registry) {
  const tool = reg[name];
  return tool.callback(tool.config.inputSchema.parse(args));
}

describe('non-post handlers — success, empty and error (mocked HTTP only)', () => {
  it('search_posts: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=link&sort=relevance&limit=25';
    upstream = { [url]: { status: 200, body: POST_LIST_HTML } };
    const ok = await invoke('search_posts', { query: 'rust' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).resultCount).toBeGreaterThan(0);
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };
    const empty = await invoke('search_posts', { query: 'rust' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });

    upstream = { [url]: { status: 503, body: '' } };
    const failed = await invoke('search_posts', { query: 'rust' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error searching Reddit:');
    expect(failed.content[0].text).toContain('503');
  });

  it('get_posts: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/r/rust/hot';
    upstream = { [url]: { status: 200, body: SUBREDDIT_MAIN_HTML } };
    const ok = await invoke('get_posts', { subreddit: 'rust' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).resultCount).toBeGreaterThan(0);
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };
    const empty = await invoke('get_posts', { subreddit: 'rust' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });

    upstream = { [url]: { status: 500, body: '' } };
    const failed = await invoke('get_posts', { subreddit: 'rust' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error fetching posts:');
    expect(failed.content[0].text).toContain('500');
  });

  it('search_subreddits: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=sr';
    upstream = { [url]: { status: 200, body: SUBREDDIT_SEARCH_HTML } };
    const ok = await invoke('search_subreddits', { query: 'rust' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).resultCount).toBeGreaterThan(0);
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };
    const empty = await invoke('search_subreddits', { query: 'rust' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ resultCount: 0, subreddits: [] });

    upstream = { [url]: { status: 502, body: '' } };
    const failed = await invoke('search_subreddits', { query: 'rust' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error searching subreddits:');
  });

  it('search_users: empty and upstream error (success is covered above)', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=user';
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };
    const empty = await invoke('search_users', { query: 'rust' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ resultCount: 0, users: [] });

    upstream = { [url]: { status: 500, body: '' } };
    const failed = await invoke('search_users', { query: 'rust' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error searching users:');
  });

  it('get_user: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/user/spez';
    upstream = { [url]: { status: 200, body: USER_OVERVIEW_HTML } };
    const ok = await invoke('get_user', { username: 'spez' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).username).toBe('spez');
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_USER_HTML } };
    const empty = await invoke('get_user', { username: 'spez' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ postCount: 0, commentCount: 0 });

    upstream = { [url]: { status: 404, body: '' } };
    const failed = await invoke('get_user', { username: 'spez' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error fetching user profile:');
    expect(failed.content[0].text).toContain('404');
  });

  it('get_front_page: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/';
    upstream = { [url]: { status: 200, body: FRONTPAGE_HTML } };
    const ok = await invoke('get_front_page', {});
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).resultCount).toBeGreaterThan(0);
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };
    const empty = await invoke('get_front_page', {});
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });

    upstream = { [url]: { status: 500, body: '' } };
    const failed = await invoke('get_front_page', {});
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error fetching front page:');
  });

  it('get_subreddit_info: success, empty and upstream error from either page', async () => {
    const sidebar = 'http://redlib.test:8080/r/rust/about/sidebar';
    const main = 'http://redlib.test:8080/r/rust/hot';
    upstream = {
      [sidebar]: { status: 200, body: SUBREDDIT_INFO_HTML },
      [main]: { status: 200, body: SUBREDDIT_MAIN_HTML },
    };
    const ok = await invoke('get_subreddit_info', { subreddit: 'rust' });
    expect(ok.isError).not.toBe(true);
    expect(requestedUrls.sort()).toEqual([sidebar, main].sort());

    requestedUrls = [];
    upstream = {
      [sidebar]: { status: 200, body: EMPTY_WIKI_HTML },
      [main]: { status: 200, body: EMPTY_LISTING_HTML },
    };
    const empty = await invoke('get_subreddit_info', { subreddit: 'rust' });
    expect(empty.isError).not.toBe(true);

    requestedUrls = [];
    upstream = {
      [sidebar]: { status: 500, body: '' },
      [main]: { status: 200, body: SUBREDDIT_MAIN_HTML },
    };
    const failed = await invoke('get_subreddit_info', { subreddit: 'rust' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error fetching subreddit info:');
  });

  it('get_wiki_page: success, empty and upstream error', async () => {
    const url = 'http://redlib.test:8080/r/demo/wiki/index';
    upstream = { [url]: { status: 200, body: WIKI_FIXTURE_HTML } };
    const ok = await invoke('get_wiki_page', { subreddit: 'demo' });
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.content[0].text).title).toBe('index');
    expect(requestedUrls).toEqual([url]);

    requestedUrls = [];
    upstream = { [url]: { status: 200, body: EMPTY_WIKI_HTML } };
    const empty = await invoke('get_wiki_page', { subreddit: 'demo' });
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(empty.content[0].text)).toEqual({ title: 'index', content: '' });

    upstream = { [url]: { status: 500, body: '' } };
    const failed = await invoke('get_wiki_page', { subreddit: 'demo' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Error fetching wiki page:');
  });
});

describe('page-structure validation for non-post handlers (mocked HTTP only)', () => {
  const cases: Array<[string, unknown, string]> = [
    ['search_posts', { query: 'x' }, 'http://redlib.test:8080/search?q=x&type=link&sort=relevance&limit=25'],
    ['get_posts', { subreddit: 'demo' }, 'http://redlib.test:8080/r/demo/hot'],
    ['search_subreddits', { query: 'x' }, 'http://redlib.test:8080/search?q=x&type=sr'],
    ['search_users', { query: 'x' }, 'http://redlib.test:8080/search?q=x&type=user'],
    ['get_user', { username: 'demo' }, 'http://redlib.test:8080/user/demo'],
    ['get_front_page', {}, 'http://redlib.test:8080/'],
  ];

  it.each(cases)('%s fails a recognised error view served with HTTP 200', async (name, args, url) => {
    upstream = { [url]: { status: 200, body: ERROR_VIEW_HTML } };
    const result = await invoke(name, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Redlib returned an error page: Subreddit not found');
  });

  it.each(cases)('%s fails a page without the expected content column', async (name, args, url) => {
    upstream = { [url]: { status: 200, body: '<!DOCTYPE html><html><body><main></main></body></html>' } };
    const result = await invoke(name, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing the expected content column');
  });

  it('does not infer failure from error words or an id="error" element inside valid content', async () => {
    const html =
      '<!DOCTYPE html><html><body><main><div id="column_one">' +
      '<div id="posts"><article><p>Error handling discussion</p>' +
      '<div id="error"><h1>Subreddit not found</h1></div></article></div>' +
      '</div></main></body></html>';
    const url = 'http://redlib.test:8080/r/demo/hot';
    upstream = { [url]: { status: 200, body: html } };

    const result = await invoke('get_posts', { subreddit: 'demo' });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text).resultCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Batch D: URL construction, segment validation and base confinement.
// ---------------------------------------------------------------------------

describe('non-post URL construction and segment encoding', () => {
  it('preserves the multireddit + separator in subreddit routes and searches', async () => {
    const hot = 'http://redlib.test:8080/r/a+b/hot';
    const search = 'http://redlib.test:8080/r/a+b/search?q=x&type=comment&restrict_sr=on&sort=relevance&limit=25';
    upstream = {
      [hot]: { status: 200, body: EMPTY_LISTING_HTML },
      [search]: { status: 200, body: EMPTY_LISTING_HTML },
    };

    expect((await invoke('get_posts', { subreddit: 'a+b' })).isError).not.toBe(true);
    expect((await invoke('search_comments', { query: 'x', subreddit: 'a+b' })).isError).not.toBe(true);
    expect(requestedUrls).toEqual([hot, search]);
    expect(requestedUrls.some((url) => url.includes('%2B'))).toBe(false);
  });

  it('encodes raw segments exactly once and rejects double slashes', async () => {
    const spaced = 'http://redlib.test:8080/r/a%20b/hot';
    const wiki = 'http://redlib.test:8080/r/demo/wiki/a%20b/c';
    upstream = {
      [spaced]: { status: 200, body: EMPTY_LISTING_HTML },
      [wiki]: { status: 200, body: EMPTY_WIKI_HTML },
    };

    expect((await invoke('get_posts', { subreddit: 'a b' })).isError).not.toBe(true);
    expect((await invoke('get_wiki_page', { subreddit: 'demo', page: 'a b/c' })).isError).not.toBe(true);
    expect(requestedUrls).toEqual([spaced, wiki]);
    for (const url of requestedUrls) {
      expect(url).not.toContain('%2520');
      expect(url.replace(/^http:\/\//, '')).not.toContain('//');
    }
  });

  it('accepts a configured base prefix with a trailing slash without duplicating it', async () => {
    const prefixed = makeRegistry({ baseUrl: 'http://redlib.test:8080/internal/' });
    const url = 'http://redlib.test:8080/internal/r/demo/hot';
    upstream = { [url]: { status: 200, body: EMPTY_LISTING_HTML } };

    const result = await invoke('get_posts', { subreddit: 'demo' }, prefixed);
    expect(result.isError).not.toBe(true);
    expect(requestedUrls).toEqual([url]);
  });

  it.each([
    ['slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['query delimiter', 'a?b'],
    ['fragment delimiter', 'a#b'],
    ['control character', 'a\u0000b'],
    ['dot segment', '.'],
    ['dot-dot segment', '..'],
    ['empty name', ''],
  ])('rejects a subreddit name with a %s before any fetch', async (_label, subreddit) => {
    for (const name of ['get_posts', 'get_subreddit_info', 'get_wiki_page']) {
      const args = name === 'get_wiki_page' ? { subreddit, page: 'index' } : { subreddit };
      const result = await invoke(name, args);
      expect(result.isError).toBe(true);
    }
    expect(requestedUrls).toEqual([]);
  });

  it.each([
    ['dot segment', 'a/../b'],
    ['empty segment', 'a//b'],
    ['leading empty segment', '/a'],
    ['trailing empty segment', 'a/'],
    ['backslash', 'a\\b'],
    ['query delimiter', 'a?b'],
    ['fragment delimiter', 'a#b'],
    ['dot page', '.'],
    ['empty page name', ''],
  ])('rejects a wiki page with a %s before any fetch', async (_label, page) => {
    const result = await invoke('get_wiki_page', { subreddit: 'demo', page });
    expect(result.isError).toBe(true);
    expect(requestedUrls).toEqual([]);
  });

  it('rejects a username with a structural delimiter before any fetch', async () => {
    for (const username of ['a/b', 'a\\b', 'a?b', 'a#b', 'a\u0001b']) {
      const result = await invoke('get_user', { username });
      expect(result.isError).toBe(true);
    }
    expect(requestedUrls).toEqual([]);
  });

  it('rejects a redirect that downgrades from https to http without a second fetch', async () => {
    const https = makeRegistry({ baseUrl: 'https://redlib.test' });
    upstream = {
      'https://redlib.test/r/demo/hot': { status: 301, location: 'http://redlib.test/r/demo/hot2' },
    };

    const result = await invoke('get_posts', { subreddit: 'demo' }, https);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('insecure scheme');
    expect(requestedUrls).toEqual(['https://redlib.test/r/demo/hot']);
  });

  it('rejects invalid configured bases before registration completes', () => {
    expect(() => makeRegistry({ baseUrl: 'not-a-url' })).toThrow('Invalid Redlib base URL');
    expect(() => makeRegistry({ baseUrl: 'ftp://redlib.test' })).toThrow('must use http or https');
    expect(() => makeRegistry({ baseUrl: 'https://user:pass@redlib.test' })).toThrow('must not contain credentials');
  });
});

// ---------------------------------------------------------------------------
// Batch D: numeric limit schemas.
// ---------------------------------------------------------------------------

describe('advertised limits — nonnegative finite integers', () => {
  const limits: Array<[string, unknown, string, number]> = [
    ['search_posts', { query: 'q' }, 'limit', 25],
    ['get_posts', { subreddit: 's' }, 'limit', 25],
    ['get_post', { postId: 'abc123' }, 'comment_limit', 10],
    ['search_subreddits', { query: 'q' }, 'limit', 25],
    ['search_users', { query: 'q' }, 'limit', 25],
    ['get_user', { username: 'u' }, 'limit', 25],
    ['get_front_page', {}, 'limit', 25],
    ['search_comments', { query: 'q' }, 'limit', 25],
  ];

  it.each(limits)('%s %s %s defaults to %d', (name, args, field, expected) => {
    const schema = registry[name].config.inputSchema;
    expect(schema.parse(args)[field]).toBe(expected);
  });

  it.each(limits)('%s %s accepts zero and large finite integers', (name, args, field) => {
    const schema = registry[name].config.inputSchema;
    expect(schema.parse({ ...(args as object), [field]: 0 })[field]).toBe(0);
    expect(schema.parse({ ...(args as object), [field]: 1e30 })[field]).toBe(1e30);
    expect(schema.parse({ ...(args as object), [field]: Number.MAX_SAFE_INTEGER })[field]).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it.each(limits)('%s %s rejects negative, fractional, non-numeric and non-finite values', (name, args, field) => {
    const schema = registry[name].config.inputSchema;
    for (const value of [-1, 2.5, '5', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => schema.parse({ ...(args as object), [field]: value })).toThrow();
    }
  });

  it.each(limits)('%s accepts decoded 1e309 JSON as non-finite and rejects it', (name, args, field) => {
    const schema = registry[name].config.inputSchema;
    const decoded = JSON.parse(`{"value":1e309}`).value;
    expect(decoded).toBe(Number.POSITIVE_INFINITY);
    expect(() => schema.parse({ ...(args as object), [field]: decoded })).toThrow();
  });

  it('rejects missing required fields and invalid enums at the schema boundary', () => {
    expect(() => registry['get_posts'].config.inputSchema.parse({})).toThrow();
    expect(() => registry['get_posts'].config.inputSchema.parse({ subreddit: 's', sort: 'bogus' })).toThrow();
    expect(() => registry['get_front_page'].config.inputSchema.parse({ feed: 'bogus' })).toThrow();
    expect(() => registry['get_user'].config.inputSchema.parse({ username: 'u', listing: 'bogus' })).toThrow();
    expect(() => registry['get_post'].config.inputSchema.parse({ postId: 'abc123', comment_sort: 'bogus' })).toThrow();
    expect(requestedUrls).toEqual([]);
  });
});

describe('zero limits — valid successful empty collections', () => {
  it('get_posts with limit 0 returns an empty success and still fetches the listing once', async () => {
    const url = 'http://redlib.test:8080/r/rust/hot';
    upstream = { [url]: { status: 200, body: SUBREDDIT_MAIN_HTML } };

    const result = await invoke('get_posts', { subreddit: 'rust', limit: 0 });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });
    expect(requestedUrls).toEqual([url]);
  });

  it('get_user with limit 0 empties both per-list collections', async () => {
    const url = 'http://redlib.test:8080/user/spez';
    upstream = { [url]: { status: 200, body: USER_OVERVIEW_HTML } };

    const result = await invoke('get_user', { username: 'spez', limit: 0 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.postCount).toBe(0);
    expect(payload.commentCount).toBe(0);
  });

  it('search_comments and search_users with limit 0 return empty successes', async () => {
    const commentUrl = 'http://redlib.test:8080/search?q=x&type=comment&sort=relevance';
    const userUrl = 'http://redlib.test:8080/search?q=x&type=user';
    upstream = {
      [commentUrl]: { status: 200, body: COMMENTS_HTML },
      [userUrl]: { status: 200, body: PEOPLE_HTML },
    };

    const comments = await invoke('search_comments', { query: 'x', limit: 0 });
    const users = await invoke('search_users', { query: 'x', limit: 0 });
    expect(JSON.parse(comments.content[0].text).resultCount).toBe(0);
    expect(JSON.parse(users.content[0].text).resultCount).toBe(0);
  });

  it('get_post comment_limit 0 returns zero comments without failing', async () => {
    const html = makePostHtml({ id: '1x7hpcl', comments: makeCommentsHtml(5) });
    upstream = { 'http://redlib.test:8080/comments/1x7hpcl': { status: 200, body: html } };

    const result = await invoke('get_post', { postId: '1x7hpcl', comment_limit: 0 });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.comments).toEqual([]);
    expect(payload.commentCount).toBe(5);
  });
});


describe('transport defaults and base normalisation', () => {
  it('keeps the accepted post-fetch budget for every non-post request', () => {
    expect(requestModule.DEFAULT_LIMITS).toEqual({
      timeoutMs: 30_000,
      maxRedirects: 5,
      maxBodyBytes: 5 * 1024 * 1024,
    });
  });

  it('normalises the base once, preserving the prefix without a trailing slash', () => {
    expect(requestModule.normalizeRedlibBase('http://redlib.test:8080')).toMatchObject({
      url: 'http://redlib.test:8080',
      origin: 'http://redlib.test:8080',
      prefix: '',
    });
    expect(requestModule.normalizeRedlibBase('http://redlib.test:8080/internal///')).toMatchObject({
      url: 'http://redlib.test:8080/internal',
      prefix: '/internal',
    });
  });
});

// ---------------------------------------------------------------------------
// R1: advertised limit JSON Schema must express the actual domain.
// ---------------------------------------------------------------------------

describe('R1 advertised limit JSON Schema', () => {
  const ADVERTISED: Array<[string, string, number]> = [
    ['search_posts', 'limit', 25],
    ['get_posts', 'limit', 25],
    ['get_post', 'comment_limit', 10],
    ['search_subreddits', 'limit', 25],
    ['search_users', 'limit', 25],
    ['get_user', 'limit', 25],
    ['get_front_page', 'limit', 25],
    ['search_comments', 'limit', 25],
  ];

  it.each(ADVERTISED)('%s.%s advertises minimum 0, multipleOf 1, default %d and no maximum', (name, field, expected) => {
    const toolSchema = registry[name].config.inputSchema;
    // Same conversion target/io the installed MCP SDK uses for tools/list.
    const json = z.toJSONSchema(toolSchema, { target: 'draft-2020-12', io: 'input' }) as {
      properties?: Record<string, Record<string, unknown>>;
    };
    const advertised = json.properties?.[field];
    expect(advertised).toMatchObject({
      type: 'number',
      minimum: 0,
      multipleOf: 1,
      default: expected,
    });
    expect(advertised?.maximum).toBeUndefined();
    expect(advertised?.exclusiveMaximum).toBeUndefined();
  });
});

describe('R1 zero limit — the three previously unexercised result collections', () => {
  it('search_posts with limit 0 returns an empty success and still fetches once', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=link&sort=relevance';
    upstream = { [url]: { status: 200, body: POST_LIST_HTML } };

    const result = await invoke('search_posts', { query: 'rust', limit: 0 });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });
    expect(requestedUrls).toEqual([url]);
  });

  it('search_subreddits with limit 0 returns an empty success and still fetches once', async () => {
    const url = 'http://redlib.test:8080/search?q=rust&type=sr';
    upstream = { [url]: { status: 200, body: SUBREDDIT_SEARCH_HTML } };

    const result = await invoke('search_subreddits', { query: 'rust', limit: 0 });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ resultCount: 0, subreddits: [] });
    expect(requestedUrls).toEqual([url]);
  });

  it('get_front_page with limit 0 returns an empty success and still fetches once', async () => {
    const url = 'http://redlib.test:8080/';
    upstream = { [url]: { status: 200, body: FRONTPAGE_HTML } };

    const result = await invoke('get_front_page', { limit: 0 });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ resultCount: 0, posts: [] });
    expect(requestedUrls).toEqual([url]);
  });
});
