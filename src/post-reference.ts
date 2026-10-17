/**
 * Pure post-reference grammar for the `get_post` tool — Task 2 slice.
 *
 * Maps a user-supplied post reference (bare id, scoped path, permalink or
 * canonical URL) to a logical, instance-relative route plus the post id the
 * fetched page is expected to carry. Performs NO network I/O and does not touch
 * the handler.
 *
 * Design rules (Task 2 contract):
 *  - Logical `path` always starts with `/`.
 *  - Scoped `r/<name>` / `user/<name>` / `u/<name>` (alias -> `/user/`) routes
 *    are authoritative: an external hint never rewrites them and no fallback is
 *    emitted.
 *  - Unscoped ids (`/comments/<id>`, `/<id>`, redd.it short links, canonical and
 *    configured-origin URLs) always resolve to `/comments/<id>` with NO
 *    fallback.
 *  - Only a BARE single-token id (slashless `1x7hpcl` / `t3_1x7hpcl`) uses the
 *    `subreddit` hint when valid: `/r/<hint>/comments/<id>` with
 *    `/user/<hint>/comments/<id>` fallback. Explicit routes/URLs never take the
 *    hint.
 *  - Share references (Task 3): `s/<token>` / `/s/<token>` (bare fragment, needs
 *    the subreddit hint) and `r/<name>/s/<token>` (scoped, optional leading
 *    slash; also accepted as a full URL on an allowed origin). The logical path
 *    is `/r/<name>/s/<EXACT token>` with NO `expectedPostId` (a share token is
 *    not a post id) and NO profile fallback. The token keeps its exact spelling;
 *    it is never decoded, re-encoded or repaired. Shares under `user`/`u` are
 *    not part of the contract and are rejected, as are malformed/empty tokens
 *    and extra segments.
 *  - Only exact Reddit hosts, redd.it/www.redd.it, and the configured
 *    REDLIB_URL / REDLIB_PUBLIC_URL origins are accepted.
 *  - Tracking query/fragment is dropped and never forwarded; only a recognised
 *    `sort` survives as `urlCommentSort`.
 *  - No ID/token case folding or "repair": supplied spelling is preserved.
 *  - Everything else is rejected before the URL parser can normalise hostile
 *    input away (backslash, protocol-relative, userinfo, dot segments, encoded
 *    separators, unsupported hosts/schemes/routes).
 *  - The subreddit hint is only consumed when it is a real string (a `null` or
 *    other non-string hint is treated as absent, never coerced to `"null"`).
 */

export interface PostReference {
  path: string;
  expectedPostId?: string;
  fallbackPath?: string;
  urlCommentSort?: 'confidence' | 'top' | 'new' | 'controversial' | 'old';
}

type CommentSort = NonNullable<PostReference['urlCommentSort']>;

const COMMENT_SORTS: readonly CommentSort[] = [
  'confidence',
  'top',
  'new',
  'controversial',
  'old',
];

// Exact canonical Reddit hosts (Task 2 contract) — no wildcard/subdomain match.
const REDDIT_HOSTS = new Set<string>([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'np.reddit.com',
  'm.reddit.com',
  'sh.reddit.com',
]);

// Compact short-link hosts: the id maps straight to /comments/<id>, and the
// shortener is never fetched.
const SHORT_LINK_HOSTS = new Set<string>(['redd.it', 'www.redd.it']);

// Words that are valid base36 but are Reddit routes/listings, so a single
// trailing segment must not be mistaken for a bare `/<id>` post. Compared
// case-insensitively.
const RESERVED_ROUTE_SEGMENTS = new Set<string>([
  'r', 'u', 'user', 'comments', 's', 'search', 'login', 'logout', 'register',
  'submit', 'wiki', 'settings', 'prefs', 'account', 'saved', 'hidden',
  'upvoted', 'downvoted', 'submitted', 'gilded', 'messages', 'message',
  'notifications', 'friends', 'random', 'explore', 'all', 'popular', 'live',
  'about', 'domain', 'duplicates', 'subreddits', 'tour', 'gold', 'premium',
  'coins', 'help', 'ads', 'report', 'rules', 'mod', 'moderation', 'rising',
  'hot', 'new', 'top', 'best', 'controversial',
]);

const NAME_SEGMENT = /^[A-Za-z0-9_-]+$/;
const ID_BODY = /^[A-Za-z0-9]+$/;
// A share token is opaque, case-sensitive and ASCII alphanumeric. It is never
// `t3_`-stripped and never decoded/re-encoded/repaired.
const SHARE_TOKEN = /^[A-Za-z0-9]+$/;
const FULLNAME_PREFIX = /^t3_/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const HTTP_URL = /^https?:\/\//i;

function reject(reason: string): never {
  throw new Error(`Unsupported post reference (${reason})`);
}

function parseIdToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const body = token.replace(FULLNAME_PREFIX, '');
  return body.length > 0 && ID_BODY.test(body) ? body : undefined;
}

function parseShareToken(segment: string | undefined): string | undefined {
  return typeof segment === 'string' && SHARE_TOKEN.test(segment) ? segment : undefined;
}

// `typeof` guard: a non-string hint (e.g. a runtime `null`) must be treated as
// absent, never coerced to the literal "null" by regex stringification.
function parseNameSegment(segment: string | undefined): string | undefined {
  return typeof segment === 'string' && NAME_SEGMENT.test(segment) ? segment : undefined;
}

// Literal dot segments must be rejected on the RAW string before the URL parser
// normalises them away.
function hasDotSegment(raw: string): boolean {
  return raw.split('/').some((segment) => segment === '.' || segment === '..');
}

function normalizeBasePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === '') return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}

function extractSort(params: URLSearchParams): CommentSort | undefined {
  const value = params.get('sort');
  return value !== null && (COMMENT_SORTS as readonly string[]).includes(value)
    ? (value as CommentSort)
    : undefined;
}

function splitQueryFragment(reference: string): { pathPart: string; sort?: CommentSort } {
  let rest = reference;
  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  let query = '';
  const mark = rest.indexOf('?');
  if (mark >= 0) {
    query = rest.slice(mark + 1);
    rest = rest.slice(0, mark);
  }
  return { pathPart: rest, sort: query === '' ? undefined : extractSort(new URLSearchParams(query)) };
}

type MatchedRoute =
  | { kind: 'post'; scoped: true; path: string; id: string }
  | { kind: 'post'; scoped: false; id: string }
  | { kind: 'share'; name: string; token: string }
  | { kind: 'share-bare'; token: string };

function matchPostRoute(segments: string[]): MatchedRoute | undefined {
  if (segments.length === 0) return undefined;
  const head = segments[0];

  // Scoped share: r/<name>/s/<token>. Shares under user/u are not part of the
  // contract, so only `r` reaches this branch. Extra segments are malformed.
  if (head === 'r' && segments.length === 4 && segments[2] === 's') {
    const name = parseNameSegment(segments[1]);
    const token = parseShareToken(segments[3]);
    if (name === undefined || token === undefined) return undefined;
    return { kind: 'share', name, token };
  }

  // Bare share fragment: s/<token> (the leading slash, if any, is already gone).
  // `s` is a reserved route marker, so a malformed or empty token is rejected
  // rather than silently reinterpreted as the bare id `s`.
  if (head === 's') {
    if (segments.length !== 2) return undefined;
    const token = parseShareToken(segments[1]);
    return token === undefined ? undefined : { kind: 'share-bare', token };
  }

  // Scoped: r/<name>/comments/<id>[...] | user/<name>/... | u/<name>/... (alias)
  if (head === 'r' || head === 'user' || head === 'u') {
    if (segments.length < 4 || segments[2] !== 'comments') return undefined;
    const name = parseNameSegment(segments[1]);
    const id = parseIdToken(segments[3]);
    if (name === undefined || id === undefined) return undefined;
    const prefix = head === 'r' ? 'r' : 'user';
    return { kind: 'post', scoped: true, path: `/${prefix}/${name}/comments/${id}`, id };
  }

  // /comments/<id>[...]
  if (head === 'comments') {
    const id = segments.length >= 2 ? parseIdToken(segments[1]) : undefined;
    return id === undefined ? undefined : { kind: 'post', scoped: false, id };
  }

  // /<id>
  if (segments.length === 1 && !RESERVED_ROUTE_SEGMENTS.has(head.toLowerCase())) {
    const id = parseIdToken(head);
    return id === undefined ? undefined : { kind: 'post', scoped: false, id };
  }

  return undefined;
}

function pathToRoute(pathname: string): MatchedRoute | undefined {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') return undefined;
  if (!trimmed.startsWith('/')) return undefined;
  const segments = trimmed.split('/').slice(1); // drop the leading empty segment
  if (segments.some((segment) => segment === '')) return undefined; // double slash
  return matchPostRoute(segments);
}

// A bare, slashless single-token id (optionally `t3_`-prefixed). Reserved route
// words (`r`, `user`, `comments`, `search`, `all`, ...) are routes, not ids, so
// they are excluded exactly as in the `/<id>` rule. This is the only relative
// form the subreddit hint may scope.
function bareIdToken(raw: string): string | undefined {
  if (raw.startsWith('/') || raw.includes('/')) return undefined;
  if (RESERVED_ROUTE_SEGMENTS.has(raw.toLowerCase())) return undefined;
  return parseIdToken(raw);
}

function buildUnscoped(
  id: string,
  hint: string | undefined,
  sort: CommentSort | undefined
): PostReference {
  const ref: PostReference =
    hint !== undefined
      ? {
          path: `/r/${hint}/comments/${id}`,
          expectedPostId: id,
          fallbackPath: `/user/${hint}/comments/${id}`,
        }
      : { path: `/comments/${id}`, expectedPostId: id };
  return sort === undefined ? ref : { ...ref, urlCommentSort: sort };
}

function buildFromRoute(route: MatchedRoute, sort: CommentSort | undefined): PostReference {
  // An unscoped share fragment has no scope of its own and URLs never borrow the
  // hint, so it cannot be resolved here.
  if (route.kind === 'share-bare') reject('share reference requires subreddit');
  const ref: PostReference =
    route.kind === 'share'
      ? { path: `/r/${route.name}/s/${route.token}` }
      : route.scoped
        ? { path: route.path, expectedPostId: route.id }
        : { path: `/comments/${route.id}`, expectedPostId: route.id };
  return sort === undefined ? ref : { ...ref, urlCommentSort: sort };
}

function matchConfiguredOrigin(
  url: URL,
  config: { baseUrl: string; publicBaseUrl: string }
): string | undefined {
  for (const candidate of [config.baseUrl, config.publicBaseUrl]) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.origin === url.origin) return normalizeBasePath(parsed.pathname);
  }
  return undefined;
}

function shortLinkId(pathname: string): string | undefined {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '' || trimmed.includes('/')) return undefined;
  return parseIdToken(trimmed);
}

function parseHttpUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    reject('unparseable URL');
  }
}

function fromUrl(url: URL, config: { baseUrl: string; publicBaseUrl: string }): PostReference {
  const host = url.hostname.toLowerCase();
  const sort = extractSort(url.searchParams);

  if (SHORT_LINK_HOSTS.has(host)) {
    const id = shortLinkId(url.pathname) ?? reject('unexpected short-link path');
    return buildFromRoute({ kind: 'post', scoped: false, id }, sort);
  }

  const basePath = matchConfiguredOrigin(url, config);
  if (basePath !== undefined) {
    const route = pathToRoute(stripBasePath(url.pathname, basePath)) ?? reject('unsupported route');
    return buildFromRoute(route, sort);
  }

  if (REDDIT_HOSTS.has(host)) {
    const route = pathToRoute(url.pathname) ?? reject('unsupported route');
    return buildFromRoute(route, sort);
  }

  reject('unsupported host');
}

export function parsePostReference(
  input: string,
  subreddit: string | undefined,
  config: { baseUrl: string; publicBaseUrl: string }
): PostReference {
  const raw = (input ?? '').trim();
  if (raw === '') reject('empty reference');

  // Hostile-shape gate — run on the raw string BEFORE any URL normalisation can
  // hide a separator, dot segment or protocol-relative prefix.
  if (/\s/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) {
    reject('whitespace or control characters');
  }
  if (raw.includes('\\')) reject('backslash');
  if (/%2e|%2f|%5c|%25/i.test(raw)) reject('encoded separator or dot segment');
  if (raw.startsWith('//')) reject('protocol-relative reference');
  // WHATWG would happily collapse `https:////reddit.com/...` to `reddit.com`, so
  // pin the strict `scheme://` spelling (exactly two slashes) before it parses.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/{3,}/.test(raw)) reject('malformed scheme separator');
  if (hasDotSegment(raw)) reject('dot segment');

  const hint = parseNameSegment(subreddit);

  const scheme = SCHEME.exec(raw);
  if (scheme !== null) {
    if (!HTTP_URL.test(raw)) reject(`unsupported scheme ${scheme[1]}`);
    const url = parseHttpUrl(raw);
    if (url.username !== '' || url.password !== '') reject('userinfo in URL');
    return fromUrl(url, config);
  }

  const { pathPart, sort } = splitQueryFragment(raw);

  // A bare, slashless single-token id is the ONLY relative form the subreddit
  // hint may scope. Everything else (explicit `/comments/<id>`, `/<id>`, scoped
  // routes, URLs) keeps its own route and never takes the hint.
  const bare = bareIdToken(pathPart);
  if (bare !== undefined) return buildUnscoped(bare, hint, sort);

  const logical = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const route = pathToRoute(logical) ?? reject('unsupported route');
  // A bare share fragment is the only relative share form the hint may scope;
  // without it there is no subreddit to build a logical path from.
  if (route.kind === 'share-bare') {
    if (hint === undefined) reject('share reference requires subreddit');
    const ref: PostReference = { path: `/r/${hint}/s/${route.token}` };
    return sort === undefined ? ref : { ...ref, urlCommentSort: sort };
  }
  return buildFromRoute(route, sort);
}
