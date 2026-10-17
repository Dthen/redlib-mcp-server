import { parsePostReference } from '../src/post-reference.js';
import type { PostReference } from '../src/post-reference.js';

/**
 * Task 2 — post-reference grammar (pure, table-driven).
 *
 * Every supported reference maps to a logical, instance-relative `path` plus
 * the `expectedPostId` the fetched page must carry. Rejected references throw.
 * No network, no handler coupling.
 */

type Config = { baseUrl: string; publicBaseUrl: string };

const DEFAULT_CONFIG: Config = {
  baseUrl: 'http://127.0.0.1:8080',
  publicBaseUrl: 'https://www.reddit.com',
};

// Instance/public origins that are NOT canonical Reddit hosts, proving
// configured-origin acceptance is independent of the Reddit host allow-list.
const INSTANCE_CONFIG: Config = {
  baseUrl: 'http://redlib.internal:3000',
  publicBaseUrl: 'https://rd.example.com',
};

// Origin + non-root base path: a matching configured base path must be stripped.
const BASE_PATH_CONFIG: Config = {
  baseUrl: 'http://127.0.0.1:8080/redlib',
  publicBaseUrl: 'https://rd.example.com/redlib',
};

interface ValidCase {
  name: string;
  input: string;
  subreddit?: string;
  config?: Config;
  expected: PostReference;
}

interface RejectCase {
  name: string;
  input: string;
  subreddit?: string;
  config?: Config;
}

const bareIdCases: ValidCase[] = [
  {
    name: 'bare id, no hint',
    input: '1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'bare id, with subreddit hint -> r/ path + user/ fallback',
    input: '1x7hpcl',
    subreddit: 'webscraping',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      fallbackPath: '/user/webscraping/comments/1x7hpcl',
    },
  },
  {
    name: 'bare id preserves supplied case',
    input: '1X7HPCL',
    expected: { path: '/comments/1X7HPCL', expectedPostId: '1X7HPCL' },
  },
  {
    name: 'bare id trims surrounding whitespace only',
    input: '  1x7hpcl  ',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const fullnameCases: ValidCase[] = [
  {
    name: 't3_ fullname prefix is removed (no hint)',
    input: 't3_1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 't3_ fullname prefix with hint',
    input: 't3_1x7hpcl',
    subreddit: 'webscraping',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      fallbackPath: '/user/webscraping/comments/1x7hpcl',
    },
  },
  {
    name: 't3_ prefix inside a scoped path',
    input: '/r/webscraping/comments/t3_1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const scopedCases: ValidCase[] = [
  {
    name: 'r/<name> scoped path without leading slash',
    input: 'r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'r/<name> scoped path with leading slash',
    input: '/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'scoped path is authoritative: hint does not rewrite it and no fallback',
    input: '/r/webscraping/comments/1x7hpcl',
    subreddit: 'other-hint',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'user/<name> profile path',
    input: 'user/spez/comments/1x7hpcl',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'u/<name> alias maps to /user/',
    input: '/u/spez/comments/1x7hpcl',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'u/<name> alias without leading slash',
    input: 'u/spez/comments/1x7hpcl',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'profile path is authoritative over hint, no fallback',
    input: '/user/spez/comments/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'name segments allow letters/digits/underscore/hyphen',
    input: '/r/my-sub_1/comments/1x7hpcl',
    expected: { path: '/r/my-sub_1/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const commentsRouteCases: ValidCase[] = [
  {
    name: '/comments/<id>',
    input: '/comments/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'comments/<id> without leading slash',
    input: 'comments/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'explicit /comments/<id> ignores hint (no fallback)',
    input: '/comments/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const barePathCases: ValidCase[] = [
  {
    name: '/<id> single segment',
    input: '/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'explicit /<id> ignores hint (no fallback)',
    input: '/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const redditHostCases: ValidCase[] = [
  {
    name: 'https://reddit.com permalink',
    input: 'https://reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://www.reddit.com permalink',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://old.reddit.com permalink',
    input: 'https://old.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://new.reddit.com permalink',
    input: 'https://new.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://np.reddit.com permalink',
    input: 'https://np.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://m.reddit.com permalink',
    input: 'https://m.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://sh.reddit.com permalink',
    input: 'https://sh.reddit.com/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'http://reddit.com /comments/<id>',
    input: 'http://reddit.com/comments/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'reddit profile permalink',
    input: 'https://www.reddit.com/u/spez/comments/1x7hpcl',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'canonical unscoped URL ignores hint (no fallback)',
    input: 'https://www.reddit.com/comments/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'canonical scoped URL ignores contradictory hint',
    input: 'https://www.reddit.com/r/foo/comments/1x7hpcl',
    subreddit: 'other-hint',
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const suffixCases: ValidCase[] = [
  {
    name: 'reddit permalink strips slug and comment-id suffix',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl/example_slug/abcdef/',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'logical scoped path strips slug and comment suffix',
    input: '/r/webscraping/comments/1x7hpcl/example_slug/abcdefg',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: '/comments route strips trailing slug',
    input: '/comments/1x7hpcl/example_slug/',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'profile path strips trailing slug',
    input: '/user/spez/comments/1x7hpcl/some_slug',
    expected: { path: '/user/spez/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'reddit permalink strips suffix, keeps tracked sort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl/example_slug/abcdef/?context=3&sort=old',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'old',
    },
  },
];

const configuredOriginCases: ValidCase[] = [
  {
    name: 'configured REDLIB_URL origin, scoped route',
    input: 'http://127.0.0.1:8080/r/webscraping/comments/1x7hpcl',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'configured REDLIB_URL origin, /comments route',
    input: 'http://127.0.0.1:8080/comments/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'configured REDLIB_URL origin, bare /<id>',
    input: 'http://127.0.0.1:8080/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'configured origin unscoped URL ignores hint (no fallback)',
    input: 'http://127.0.0.1:8080/comments/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'public-origin unscoped URL ignores hint (no fallback)',
    input: 'https://rd.example.com/comments/1x7hpcl',
    subreddit: 'webscraping',
    config: INSTANCE_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'custom instance origin (non-Reddit host), scoped route',
    input: 'http://redlib.internal:3000/r/foo/comments/1x7hpcl',
    config: INSTANCE_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'configured REDLIB_PUBLIC_URL origin (custom), scoped route',
    input: 'https://rd.example.com/r/foo/comments/1x7hpcl',
    config: INSTANCE_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'configured REDLIB_PUBLIC_URL origin (custom), /comments route',
    input: 'https://rd.example.com/comments/1x7hpcl',
    config: INSTANCE_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'matching configured base path is stripped (instance)',
    input: 'http://127.0.0.1:8080/redlib/r/foo/comments/1x7hpcl',
    config: BASE_PATH_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'matching configured base path is stripped (public)',
    input: 'https://rd.example.com/redlib/comments/1x7hpcl',
    config: BASE_PATH_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'redd.it still works under a prefixed config',
    input: 'https://redd.it/1x7hpcl',
    config: BASE_PATH_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const shortLinkCases: ValidCase[] = [
  {
    name: 'https://redd.it/<id>',
    input: 'https://redd.it/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'https://www.redd.it/<id>',
    input: 'https://www.redd.it/1x7hpcl',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'redd.it ignores tracking query',
    input: 'https://redd.it/1x7hpcl?share_id=abc123&utm_source=share',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'redd.it compact id ignores hint (no fallback)',
    input: 'https://redd.it/1x7hpcl',
    subreddit: 'webscraping',
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const sortCases: ValidCase[] = [
  {
    name: 'sort=confidence surfaced as urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=confidence',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'confidence',
    },
  },
  {
    name: 'sort=top surfaced as urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=top',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'top',
    },
  },
  {
    name: 'sort=new surfaced as urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=new',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'new',
    },
  },
  {
    name: 'sort=controversial surfaced as urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=controversial',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'controversial',
    },
  },
  {
    name: 'sort=old surfaced as urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=old',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'old',
    },
  },
  {
    name: 'logical path keeps tracked sort',
    input: '/r/webscraping/comments/1x7hpcl?sort=top&t=all',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'top',
    },
  },
  {
    name: 'sort survives a fragment',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=controversial#comment-abc',
    expected: {
      path: '/r/webscraping/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
      urlCommentSort: 'controversial',
    },
  },
  {
    name: 'unsupported sort value is ignored, not forwarded',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=best&foo=bar',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'uppercase sort value is not recognised (no repair)',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?sort=TOP',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'tracking-only query leaves no urlCommentSort',
    input: 'https://www.reddit.com/r/webscraping/comments/1x7hpcl?utm_source=share&utm_medium=web',
    expected: { path: '/r/webscraping/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
];

const rejectCases: RejectCase[] = [
  { name: 'empty string', input: '' },
  { name: 'whitespace only', input: '   ' },
  { name: 'internal whitespace', input: 'not a valid ref' },
  { name: '/search route', input: '/search' },
  { name: 'search (no slash) route', input: 'search' },
  { name: '/login route', input: '/login' },
  { name: 'login (no slash) route', input: 'login' },
  { name: '/all listing', input: '/all' },
  { name: '/popular listing', input: '/popular' },
  { name: 'incomplete scoped path (missing comments)', input: '/r/webscraping' },
  { name: 'scoped path missing post id', input: '/r/webscraping/comments' },
  { name: 'multi-segment non-route token', input: '1x7hpcl/extra' },
  { name: 'bare t3_ with no id body', input: 't3_' },
  { name: 'arbitrary host', input: 'https://evil.example.com/r/foo/comments/1x7hpcl' },
  { name: 'look-alike host', input: 'https://reddit.com.evil.example.com/r/foo/comments/1x7hpcl' },
  { name: 'non-http scheme', input: 'ftp://reddit.com/r/foo/comments/1x7hpcl' },
  { name: 'javascript scheme', input: 'javascript:alert(1)' },
  { name: 'userinfo in URL', input: 'https://user:pass@reddit.com/r/foo/comments/1x7hpcl' },
  { name: 'protocol-relative URL', input: '//reddit.com/r/foo/comments/1x7hpcl' },
  { name: 'backslash separator', input: 'https://reddit.com/r/foo\\comments\\1x7hpcl' },
  { name: 'literal dot segment', input: 'https://reddit.com/r/foo/../search' },
  { name: 'literal current-dir segment', input: '/r/foo/./comments/1x7hpcl' },
  { name: 'encoded dot segment', input: 'https://reddit.com/r/foo/%2e%2e/search' },
  { name: 'encoded slash separator', input: 'https://reddit.com/r/%2f/comments/1x7hpcl' },
  { name: 'double-encoded separator', input: 'https://reddit.com/r/foo/%252e%252e/1x7hpcl' },
  { name: 'reddit origin with no route', input: 'https://www.reddit.com' },
  { name: 'unsupported /comments-less profile path', input: '/user/spez' },
  { name: 'scheme without authority', input: 'http:reddit.com/r/foo/comments/1x7hpcl' },
  // Task 3 boundary: share syntax (s/<token>) is NOT part of this slice.
  { name: 'share link (deferred to Task 3)', input: 's/yf4R7bbaHP', subreddit: 'webscraping' },
  { name: 'share link with slash (deferred to Task 3)', input: '/r/webscraping/s/yf4R7bbaHP' },
];

function runValid(cases: ValidCase[]): void {
  it.each(cases)('$name', ({ input, subreddit, config, expected }) => {
    expect(parsePostReference(input, subreddit, config ?? DEFAULT_CONFIG)).toEqual(expected);
  });
}

describe('parsePostReference — bare ids', () => {
  runValid(bareIdCases);
  it('matches the contract example exactly', () => {
    expect(
      parsePostReference('1x7hpcl', undefined, {
        baseUrl: 'http://127.0.0.1:8080',
        publicBaseUrl: 'https://www.reddit.com',
      })
    ).toEqual({ path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' });
  });
});

describe('parsePostReference — t3_ fullname prefix', () => {
  runValid(fullnameCases);
});

describe('parsePostReference — scoped subreddit/profile routes', () => {
  runValid(scopedCases);
});

describe('parsePostReference — /comments/<id> route', () => {
  runValid(commentsRouteCases);
});

describe('parsePostReference — /<id> route', () => {
  runValid(barePathCases);
});

describe('parsePostReference — canonical Reddit hosts', () => {
  runValid(redditHostCases);
});

describe('parsePostReference — slug/comment suffix stripping', () => {
  runValid(suffixCases);
});

describe('parsePostReference — configured instance/public origins', () => {
  runValid(configuredOriginCases);
});

describe('parsePostReference — redd.it short links', () => {
  runValid(shortLinkCases);
});

describe('parsePostReference — source comment-sort extraction', () => {
  runValid(sortCases);
});

describe('parsePostReference — rejected references', () => {
  it.each(rejectCases)('$name', ({ input, subreddit, config }) => {
    expect(() => parsePostReference(input, subreddit, config ?? DEFAULT_CONFIG)).toThrow(
      /Unsupported post reference/
    );
  });
});
