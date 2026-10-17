import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, Headers } from 'node-fetch';

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
