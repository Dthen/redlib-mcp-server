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

// Trailing slash on the configured origins must normalize away (Task 3).
const TRAILING_SLASH_CONFIG: Config = {
  baseUrl: 'http://127.0.0.1:8080/',
  publicBaseUrl: 'https://rd.example.com/',
};

// Origin + non-root base path WITH trailing slashes.
const BASE_PATH_TRAILING_CONFIG: Config = {
  baseUrl: 'http://127.0.0.1:8080/redlib/',
  publicBaseUrl: 'https://rd.example.com/redlib/',
};

// Follow-up (Task 2) — same origin, two DISTINCT configured path prefixes. The
// reported bug: the first configured origin matched unconditionally, so the
// public prefix was shadowed (stripped with the internal prefix, then rejected).
const SAME_ORIGIN_PREFIX_CONFIG: Config = {
  baseUrl: 'http://same.example/internal',
  publicBaseUrl: 'http://same.example/public',
};
const SAME_ORIGIN_PREFIX_REVERSED_CONFIG: Config = {
  baseUrl: 'http://same.example/public',
  publicBaseUrl: 'http://same.example/internal',
};

// Same origin, OVERLAPPING prefixes: the most-specific boundary match wins.
const OVERLAP_PREFIX_CONFIG: Config = {
  baseUrl: 'http://same.example/redlib',
  publicBaseUrl: 'http://same.example/redlib/public',
};
const OVERLAP_PREFIX_REVERSED_CONFIG: Config = {
  baseUrl: 'http://same.example/redlib/public',
  publicBaseUrl: 'http://same.example/redlib',
};

// Same origin, root prefix versus a non-root prefix.
const ROOT_PREFIX_CONFIG: Config = {
  baseUrl: 'http://same.example',
  publicBaseUrl: 'http://same.example/redlib',
};
const ROOT_PREFIX_REVERSED_CONFIG: Config = {
  baseUrl: 'http://same.example/redlib',
  publicBaseUrl: 'http://same.example',
};

// Route-marker collision: root base plus an `/r` public base. A naive longest
// match strips `/r` and yields the unsupported `/foo/comments/1x7hpcl`.
const ROUTE_MARKER_PREFIX_CONFIG: Config = {
  baseUrl: 'http://same.example',
  publicBaseUrl: 'http://same.example/r',
};
const ROUTE_MARKER_PREFIX_REVERSED_CONFIG: Config = {
  baseUrl: 'http://same.example/r',
  publicBaseUrl: 'http://same.example',
};

// Segment boundary: `/public` must not be stripped from `/publicity`.
const BOUNDARY_CONFIG: Config = {
  baseUrl: 'http://same.example',
  publicBaseUrl: 'http://same.example/public',
};

// Legacy configured landing-page rejection: the first configured base is the
// internal prefix, in three public-base shapes (distinct prefix, other origin,
// same-origin root).
const LANDING_PAGE_OTHER_ORIGIN_CONFIG: Config = {
  baseUrl: 'http://same.example/internal',
  publicBaseUrl: 'http://public.example',
};
const LANDING_PAGE_ROOT_PUBLIC_CONFIG: Config = {
  baseUrl: 'http://same.example/internal',
  publicBaseUrl: 'http://same.example',
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

// Task 3 — share references. A share token is an opaque, case-sensitive
// alphanumeric handle; it is NOT a post id, so no `expectedPostId` and no
// legacy profile fallback is emitted. Scope comes from the scoped route or, for
// a bare share fragment only, from the subreddit hint.
const shareCases: ValidCase[] = [
  {
    name: 'bare share fragment + hint -> scoped share path, token case preserved',
    input: 's/yf4R7bbaHP',
    subreddit: 'webscraping',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'leading-slash share fragment is equivalent',
    input: '/s/yf4R7bbaHP',
    subreddit: 'webscraping',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'scoped share path without leading slash',
    input: 'r/webscraping/s/yf4R7bbaHP',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'scoped share path with leading slash',
    input: '/r/webscraping/s/yf4R7bbaHP',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'full original user share URL (reddit.com/r/<sub>/s/<token>)',
    input: 'https://www.reddit.com/r/webscraping/s/yf4R7bbaHP',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'share URL on bare reddit.com',
    input: 'https://reddit.com/r/webscraping/s/yf4R7bbaHP',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'share token keeps mixed case exactly',
    input: 'https://old.reddit.com/r/foo/s/AbC123xY',
    expected: { path: '/r/foo/s/AbC123xY' },
  },
  {
    name: 'scoped share is authoritative over a contradictory hint',
    input: '/r/foo/s/yf4R7bbaHP',
    subreddit: 'other-hint',
    expected: { path: '/r/foo/s/yf4R7bbaHP' },
  },
  {
    name: 'canonical scoped share URL ignores a contradictory hint',
    input: 'https://www.reddit.com/r/foo/s/yf4R7bbaHP',
    subreddit: 'other-hint',
    expected: { path: '/r/foo/s/yf4R7bbaHP' },
  },
  {
    name: 'configured REDLIB_URL origin share route',
    input: 'http://127.0.0.1:8080/r/webscraping/s/yf4R7bbaHP',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'configured public origin share route',
    input: 'https://rd.example.com/r/webscraping/s/yf4R7bbaHP',
    config: INSTANCE_CONFIG,
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'trailing slash on a bare share fragment is accepted',
    input: 's/yf4R7bbaHP/',
    subreddit: 'webscraping',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'trailing slash on a scoped share path is accepted',
    input: '/r/webscraping/s/yf4R7bbaHP/',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'bare share fragment keeps a recognized sort',
    input: 's/yf4R7bbaHP?sort=new',
    subreddit: 'webscraping',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP', urlCommentSort: 'new' },
  },
  {
    name: 'share URL keeps a recognized sort',
    input: 'https://www.reddit.com/r/webscraping/s/yf4R7bbaHP?sort=top',
    expected: { path: '/r/webscraping/s/yf4R7bbaHP', urlCommentSort: 'top' },
  },
];

// Task 3 — configured base-url shapes (trailing slash, nonempty prefix).
const baseUrlVariantCases: ValidCase[] = [
  {
    name: 'trailing slash on configured origins is normalized (instance /comments)',
    input: 'http://127.0.0.1:8080/comments/1x7hpcl',
    config: TRAILING_SLASH_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'trailing slash on configured origins is normalized (public scoped)',
    input: 'https://rd.example.com/r/foo/comments/1x7hpcl',
    config: TRAILING_SLASH_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'trailing-slash origin accepts a share route',
    input: 'http://127.0.0.1:8080/r/webscraping/s/yf4R7bbaHP',
    config: TRAILING_SLASH_CONFIG,
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
  {
    name: 'nonempty base path with trailing slash is stripped (instance)',
    input: 'http://127.0.0.1:8080/redlib/r/foo/comments/1x7hpcl',
    config: BASE_PATH_TRAILING_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'nonempty base path with trailing slash is stripped (public /comments)',
    input: 'https://rd.example.com/redlib/comments/1x7hpcl',
    config: BASE_PATH_TRAILING_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'nonempty base path with trailing slash accepts a share route',
    input: 'https://rd.example.com/redlib/r/webscraping/s/yf4R7bbaHP',
    config: BASE_PATH_TRAILING_CONFIG,
    expected: { path: '/r/webscraping/s/yf4R7bbaHP' },
  },
];

// Follow-up (Task 2) — configured base-prefix SELECTION. Each configured base is
// recognised by a segment-boundary prefix match on the same origin; the most
// specific prefix whose stripped route the existing grammar supports wins, in
// EITHER configuration order. An unsupported stripped route never masks a
// shorter valid interpretation, and `share-bare` is never selected (a full URL
// cannot borrow the subreddit hint). This is pure grammar selection, no retry.
const configuredPrefixCases: ValidCase[] = [
  {
    name: 'distinct prefixes: internal prefix resolves (internal base first)',
    input: 'http://same.example/internal/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: public prefix resolves (internal base first)',
    input: 'http://same.example/public/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: internal prefix resolves (public base first)',
    input: 'http://same.example/internal/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_REVERSED_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: public prefix resolves (public base first)',
    input: 'http://same.example/public/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_REVERSED_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: public-prefixed scoped route with a trailing slash',
    input: 'http://same.example/public/r/foo/comments/1x7hpcl/',
    config: SAME_ORIGIN_PREFIX_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: trailing-slash bases still select the public prefix',
    input: 'http://same.example/public/comments/1x7hpcl',
    config: {
      baseUrl: 'http://same.example/internal/',
      publicBaseUrl: 'http://same.example/public/',
    },
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: unprefixed scoped route stays accepted',
    input: 'http://same.example/r/foo/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'distinct prefixes: unprefixed /comments route stays accepted',
    input: 'http://same.example/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'overlap: most-specific prefix wins (short base first)',
    input: 'http://same.example/redlib/public/comments/1x7hpcl',
    config: OVERLAP_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'overlap: most-specific prefix wins (long base first)',
    input: 'http://same.example/redlib/public/comments/1x7hpcl',
    config: OVERLAP_PREFIX_REVERSED_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'overlap: the shorter prefix resolves its own route (short base first)',
    input: 'http://same.example/redlib/r/foo/comments/1x7hpcl',
    config: OVERLAP_PREFIX_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'overlap: the shorter prefix resolves its own route (long base first)',
    input: 'http://same.example/redlib/r/foo/comments/1x7hpcl',
    config: OVERLAP_PREFIX_REVERSED_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'root vs non-root: specific prefix wins (root base first)',
    input: 'http://same.example/redlib/comments/1x7hpcl',
    config: ROOT_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'root vs non-root: specific prefix wins (specific base first)',
    input: 'http://same.example/redlib/comments/1x7hpcl',
    config: ROOT_PREFIX_REVERSED_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'root vs non-root: an unprefixed route still resolves on the root base',
    input: 'http://same.example/comments/1x7hpcl',
    config: ROOT_PREFIX_REVERSED_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: '/r collision: root base first keeps the scoped route',
    input: 'http://same.example/r/foo/comments/1x7hpcl',
    config: ROUTE_MARKER_PREFIX_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: '/r collision: /r base first keeps the scoped route',
    input: 'http://same.example/r/foo/comments/1x7hpcl',
    config: ROUTE_MARKER_PREFIX_REVERSED_CONFIG,
    expected: { path: '/r/foo/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: '/r collision: a genuine /r-prefixed route still strips the /r base',
    input: 'http://same.example/r/comments/1x7hpcl',
    config: ROUTE_MARKER_PREFIX_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'segment boundary: /public is stripped only at a boundary',
    input: 'http://same.example/public/comments/1x7hpcl',
    config: BOUNDARY_CONFIG,
    expected: { path: '/comments/1x7hpcl', expectedPostId: '1x7hpcl' },
  },
  {
    name: 'legacy landing page config: an unprefixed control still resolves',
    input: 'http://same.example/comments/1x7hpcl',
    config: LANDING_PAGE_ROOT_PUBLIC_CONFIG,
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
  // Task 3 — share grammar: supported forms now pass; these pin the rejections
  // (missing context, malformed tokens, unsupported scopes, hostile hosts).
  { name: 'bare share fragment without a hint', input: 's/yf4R7bbaHP' },
  { name: 'leading-slash share fragment without a hint', input: '/s/yf4R7bbaHP' },
  { name: 'empty share token', input: 's/', subreddit: 'webscraping' },
  { name: 'share token with punctuation', input: 's/yf4R7bbaHP!', subreddit: 'webscraping' },
  { name: 'share token with an encoded separator', input: 's/yf4R7bba%2fHP', subreddit: 'webscraping' },
  { name: 'share fragment with an extra segment', input: 's/yf4R7bbaHP/extra', subreddit: 'webscraping' },
  { name: 'scoped share with an extra segment', input: '/r/foo/s/yf4R7bbaHP/extra' },
  { name: 'scoped share with an empty token', input: '/r/foo/s/' },
  { name: 'scoped share with an invalid scoped name', input: '/r/ba!d/s/yf4R7bbaHP' },
  { name: 'share under u/<name> is unsupported', input: '/u/spez/s/yf4R7bbaHP' },
  { name: 'share under user/<name> is unsupported', input: '/user/spez/s/yf4R7bbaHP' },
  { name: 'unscoped share URL cannot borrow a hint', input: 'https://www.reddit.com/s/yf4R7bbaHP', subreddit: 'webscraping' },
  { name: 'share on an external host', input: 'https://evil.example.com/r/foo/s/yf4R7bbaHP' },
  { name: 'share on a look-alike host', input: 'https://reddit.com.attacker.invalid/r/foo/s/yf4R7bbaHP' },
  { name: 'share URL with userinfo', input: 'https://user:pass@reddit.com/r/foo/s/yf4R7bbaHP' },
  { name: 'share with an unsupported scheme', input: 'ftp://reddit.com/r/foo/s/yf4R7bbaHP' },
  { name: 'protocol-relative share URL', input: '//reddit.com/r/foo/s/yf4R7bbaHP' },
  { name: 'backslash share separator', input: 'https://reddit.com/r/foo\\s\\yf4R7bbaHP' },
  { name: 'literal traversal in a share URL', input: 'https://reddit.com/r/foo/s/../../search' },
  { name: 'percent-encoded traversal in a share URL', input: 'https://reddit.com/r/foo/%2e%2e/s/yf4R7bbaHP' },
  { name: 'encoded backslash in a share path', input: 'https://reddit.com/r/foo%5cs/yf4R7bbaHP' },
  { name: 'double-encoded separator in a share path', input: 'https://reddit.com/r/foo/%252e%252e/s/yf4R7bbaHP' },
  { name: 'malformed scheme separator (extra slashes)', input: 'https:////reddit.com/r/foo/s/yf4R7bbaHP' },
  { name: 'malformed scheme separator (three slashes)', input: 'https:///reddit.com/r/foo/comments/1x7hpcl' },
  { name: 'redd.it share path is not a compact id', input: 'https://redd.it/s/yf4R7bbaHP' },
  { name: 'invalid post id punctuation', input: '/comments/1x7!pcl' },
  { name: 'unsupported wiki route', input: '/r/foo/wiki/bar' },
  // Follow-up (Task 2) — configured base-prefix selection must not reinterpret a
  // configured landing page as a bare post id, nor mis-strip at a non-boundary.
  {
    name: 'legacy landing page is not a bare post id (distinct prefixes)',
    input: 'http://same.example/internal',
    config: SAME_ORIGIN_PREFIX_CONFIG,
  },
  {
    name: 'legacy landing page with a trailing slash stays unsupported',
    input: 'http://same.example/internal/',
    config: SAME_ORIGIN_PREFIX_CONFIG,
  },
  {
    name: 'legacy landing page stays unsupported with a different public origin',
    input: 'http://same.example/internal',
    config: LANDING_PAGE_OTHER_ORIGIN_CONFIG,
  },
  {
    name: 'legacy landing page stays unsupported with a same-origin root public base',
    input: 'http://same.example/internal',
    config: LANDING_PAGE_ROOT_PUBLIC_CONFIG,
  },
  {
    name: 'legacy landing page trailing slash stays unsupported with a root public base',
    input: 'http://same.example/internal/',
    config: LANDING_PAGE_ROOT_PUBLIC_CONFIG,
  },
  {
    name: 'a longer segment is not mis-stripped as the public prefix (/publicity)',
    input: 'http://same.example/publicity/comments/1x7hpcl',
    config: SAME_ORIGIN_PREFIX_CONFIG,
  },
  {
    name: 'prefix boundary holds with a root internal base (/publicity)',
    input: 'http://same.example/publicity/comments/1x7hpcl',
    config: BOUNDARY_CONFIG,
  },
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

  // Follow-up (Task 2) — selection between same-origin configured prefixes.
  runValid(configuredPrefixCases);
});

describe('parsePostReference — redd.it short links', () => {
  runValid(shortLinkCases);
});

describe('parsePostReference — source comment-sort extraction', () => {
  runValid(sortCases);
});

describe('parsePostReference — share references (Task 3)', () => {
  runValid(shareCases);

  it('maps the exact user share URL, preserving token case, with no expected id', () => {
    const ref = parsePostReference(
      'https://www.reddit.com/r/webscraping/s/yf4R7bbaHP',
      undefined,
      DEFAULT_CONFIG
    );
    expect(ref).toEqual({ path: '/r/webscraping/s/yf4R7bbaHP' });
    expect(ref.path).toContain('/s/yf4R7bbaHP');
    expect(ref.path).not.toContain('/comments/s/');
    expect(ref.expectedPostId).toBeUndefined();
    expect(ref.fallbackPath).toBeUndefined();
  });

  it('scopes a bare share fragment with the hint and never fabricates an id', () => {
    const ref = parsePostReference('s/yf4R7bbaHP', 'webscraping', DEFAULT_CONFIG);
    expect(ref).toEqual({ path: '/r/webscraping/s/yf4R7bbaHP' });
    expect(ref.expectedPostId).toBeUndefined();
    expect(ref.fallbackPath).toBeUndefined();
  });
});

describe('parsePostReference — missing share context is actionable', () => {
  it('names the missing subreddit hint instead of guessing a scope', () => {
    expect(() => parsePostReference('s/yf4R7bbaHP', undefined, DEFAULT_CONFIG)).toThrow(
      /requires subreddit/i
    );
    expect(() => parsePostReference('/s/yf4R7bbaHP', undefined, DEFAULT_CONFIG)).toThrow(
      /requires subreddit/i
    );
  });
});

describe('parsePostReference — configured base-url shapes (Task 3)', () => {
  runValid(baseUrlVariantCases);
});

describe('parsePostReference — hint is never coerced from a non-string', () => {
  it('ignores a null hint instead of scoping /r/null', () => {
    expect(parsePostReference('1x7hpcl', null as unknown as string, DEFAULT_CONFIG)).toEqual({
      path: '/comments/1x7hpcl',
      expectedPostId: '1x7hpcl',
    });
  });

  it('treats a null hint as missing for a bare share fragment', () => {
    expect(() =>
      parsePostReference('s/yf4R7bbaHP', null as unknown as string, DEFAULT_CONFIG)
    ).toThrow(/requires subreddit/i);
  });
});

describe('parsePostReference — rejected references', () => {
  it.each(rejectCases)('$name', ({ input, subreddit, config }) => {
    expect(() => parsePostReference(input, subreddit, config ?? DEFAULT_CONFIG)).toThrow(
      /Unsupported post reference/
    );
  });
});
