/**
 * Bounded, Redlib-only post fetch — Task 4 slice.
 *
 * Resolves a parsed `PostReference` to post HTML by fetching it from the
 * administrator's configured Redlib instance ONLY. Outbound requests always
 * target the REDLIB_URL origin (+ its base-path prefix, prepended exactly once);
 * `REDLIB_PUBLIC_URL` and Reddit URLs are reference origins that are recognised
 * and remapped onto the Redlib origin, never fetched.
 *
 * Wire contract:
 *  - `redirect: 'manual'` with a fixed, bounded redirect policy (301/302/303/
 *    307/308, at most `maxRedirects` operation hops).
 *  - A relative `Location` is resolved against the current URL; an absolute one
 *    is normalised through the SAME pure parser (`parsePostReference`) and then
 *    remapped onto the Redlib origin. External hosts, unsafe routes, userinfo,
 *    non-HTTP schemes, https->http downgrades and loops are rejected.
 *  - One operation-wide `AbortController` (default 30s) covers every request,
 *    the 404 fallback, redirects and body consumption; the timer is cleared in
 *    `finally` and each redirect/fallback body is disposed before the next
 *    request.
 *  - `node-fetch`'s `size` option caps the FINAL (decompressed) body
 *    (default 5 MiB); oversize/timeout surface as typed errors.
 *  - A known expected id is kept, or adopted from the first canonical redirect;
 *    a conflicting id-bearing redirect fails rather than silently switching.
 *  - A share reference may establish the expected id via redirect; when no
 *    canonical redirect occurs the returned id stays undefined and a later
 *    handler-side validity guard supplies identity from the HTML.
 *  - The selected comment sort (explicit option, else `ref.urlCommentSort`) is
 *    forwarded on every request; no arbitrary/tracking query is ever forwarded.
 *  - A 200 response (even an empty page) returns its HTML; the caller's validity
 *    guard rejects unusable pages.
 *
 * The `fetch`, `limits` and `commentSort` inputs are for injection in unit
 * tests; there are no new dependencies, public tool knobs or env vars.
 */

import nodeFetch from 'node-fetch';
import type { RequestInit as NodeFetchRequestInit, Response as NodeFetchResponse } from 'node-fetch';
import { parsePostReference } from './post-reference.js';
import type { PostReference } from './post-reference.js';

export type CommentSort = NonNullable<PostReference['urlCommentSort']>;

export interface PostFetchBases {
  baseUrl: string;
  publicBaseUrl: string;
}

export interface PostFetchLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxBodyBytes: number;
}

/** Minimal shape of `node-fetch`'s default export, injectable in tests. */
export type FetchLike = (url: string, init?: NodeFetchRequestInit) => Promise<NodeFetchResponse>;

export interface FetchPostHtmlOptions {
  commentSort?: CommentSort;
  fetch?: FetchLike;
  limits?: Partial<PostFetchLimits>;
}

export interface FetchPostHtmlResult {
  html: string;
  expectedPostId?: string;
}

export type PostFetchErrorCode =
  | 'http-status'
  | 'unsafe-redirect'
  | 'redirect-loop'
  | 'too-many-redirects'
  | 'redirect-id-conflict'
  | 'timeout'
  | 'too-large'
  | 'network';

/** Typed fetch failure so callers can distinguish redirect/limit/timeout/oversize. */
export class PostFetchError extends Error {
  readonly code: PostFetchErrorCode;

  constructor(code: PostFetchErrorCode, message: string) {
    super(message);
    this.name = 'PostFetchError';
    this.code = code;
  }
}

const DEFAULT_LIMITS: PostFetchLimits = {
  timeoutMs: 30_000,
  maxRedirects: 5,
  maxBodyBytes: 5 * 1024 * 1024,
};

const REDIRECT_STATUSES = new Set<number>([301, 302, 303, 307, 308]);

interface BaseOrigin {
  origin: string;
  prefix: string;
  protocol: string;
}

function normalizePrefix(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

function parseBase(baseUrl: string): BaseOrigin {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PostFetchError('network', `Invalid Redlib base URL: ${baseUrl}`);
  }
  return { origin: url.origin, prefix: normalizePrefix(url.pathname), protocol: url.protocol };
}

// The base-path prefix is prepended exactly once, and only our own sort is ever
// appended (no query from a redirect target is forwarded).
function buildUrl(base: BaseOrigin, path: string, sort: CommentSort | undefined): string {
  return `${base.origin}${base.prefix}${path}${sort === undefined ? '' : `?sort=${sort}`}`;
}

// Release an unconsumed redirect/fallback body before the next request.
function disposeBody(response: NodeFetchResponse): void {
  const body = (response as unknown as { body?: { destroy?: () => void; resume?: () => void } }).body;
  if (!body) return;
  if (typeof body.destroy === 'function') body.destroy();
  else if (typeof body.resume === 'function') body.resume();
}

interface RedirectTarget {
  path: string;
  expectedPostId?: string;
}

// Resolve a Location against the current URL, then validate/remap it through the
// SAME pure parser. Resolution cannot escape the Redlib origin unnoticed: any
// host change is rejected by the parser's host allow-list.
function resolveRedirect(
  location: string,
  currentUrl: string,
  bases: PostFetchBases,
  base: BaseOrigin
): RedirectTarget {
  let resolved: URL;
  try {
    resolved = new URL(location, currentUrl);
  } catch {
    throw new PostFetchError('unsafe-redirect', 'Redirect Location is not a valid URL');
  }
  if (base.protocol === 'https:' && resolved.protocol === 'http:') {
    throw new PostFetchError('unsafe-redirect', 'Redirect downgrades to an insecure scheme');
  }
  let parsed: PostReference;
  try {
    parsed = parsePostReference(resolved.toString(), undefined, bases);
  } catch (error) {
    throw new PostFetchError(
      'unsafe-redirect',
      `Unsafe redirect target rejected: ${(error as Error).message}`
    );
  }
  return { path: parsed.path, expectedPostId: parsed.expectedPostId };
}

function mapFetchError(error: unknown, limits: PostFetchLimits, timedOut: boolean): PostFetchError {
  if (timedOut) {
    return new PostFetchError('timeout', `Fetch exceeded the ${limits.timeoutMs}ms timeout`);
  }
  const err = error as { type?: string; name?: string; message?: string } | undefined;
  if (err?.type === 'max-size') {
    return new PostFetchError('too-large', `Response body exceeded ${limits.maxBodyBytes} bytes`);
  }
  if (err?.name === 'AbortError' || err?.type === 'aborted') {
    return new PostFetchError('timeout', `Fetch exceeded the ${limits.timeoutMs}ms timeout`);
  }
  return new PostFetchError('network', err?.message ?? String(error));
}

export async function fetchPostHtml(
  ref: PostReference,
  bases: PostFetchBases,
  options: FetchPostHtmlOptions = {}
): Promise<FetchPostHtmlResult> {
  const base = parseBase(bases.baseUrl);
  const limits: PostFetchLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const selectedSort = options.commentSort ?? ref.urlCommentSort;
  const doFetch: FetchLike = options.fetch ?? (nodeFetch as unknown as FetchLike);

  // One controller for the whole operation: every request, the fallback,
  // redirects and body consumption share this signal and its single timer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const visited = new Set<string>();

  let expectedPostId = ref.expectedPostId;
  let usedFallback = false;
  let hops = 0;
  let path = ref.path;
  let stage: 'primary' | 'fallback' | 'redirect' = 'primary';

  try {
    for (;;) {
      const url = buildUrl(base, path, selectedSort);
      if (visited.has(url)) {
        throw new PostFetchError('redirect-loop', `Redirect loop detected at ${url}`);
      }
      visited.add(url);

      let response: NodeFetchResponse;
      try {
        response = await doFetch(url, {
          redirect: 'manual',
          signal: controller.signal,
          size: limits.maxBodyBytes,
        });
      } catch (error) {
        throw mapFetchError(error, limits, controller.signal.aborted);
      }

      const status = response.status;

      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers.get('location');
        disposeBody(response);
        if (location === null || location === '') {
          throw new PostFetchError('unsafe-redirect', 'Redirect response is missing a Location header');
        }
        const target = resolveRedirect(location, url, bases, base);
        if (target.expectedPostId !== undefined) {
          if (expectedPostId === undefined) {
            expectedPostId = target.expectedPostId;
          } else if (expectedPostId !== target.expectedPostId) {
            throw new PostFetchError(
              'redirect-id-conflict',
              `Redirect changed the post id from ${expectedPostId} to ${target.expectedPostId}`
            );
          }
        }
        hops += 1;
        if (hops > limits.maxRedirects) {
          throw new PostFetchError('too-many-redirects', `Exceeded the ${limits.maxRedirects}-redirect limit`);
        }
        path = target.path;
        stage = 'redirect';
        continue;
      }

      // Fallback ONLY for a bare-ID + hint reference, and only on a PRIMARY 404
      // (never after a redirect, and never on 403/429/empty-200/error).
      if (status === 404 && stage === 'primary' && !usedFallback && ref.fallbackPath !== undefined) {
        disposeBody(response);
        usedFallback = true;
        stage = 'fallback';
        path = ref.fallbackPath;
        continue;
      }

      if (status < 200 || status >= 300) {
        disposeBody(response);
        const reason = response.statusText ? `: ${response.statusText}` : '';
        throw new PostFetchError('http-status', `Redlib returned ${status}${reason}`);
      }

      let html: string;
      try {
        html = await response.text();
      } catch (error) {
        throw mapFetchError(error, limits, controller.signal.aborted);
      }
      return expectedPostId === undefined ? { html } : { html, expectedPostId };
    }
  } finally {
    clearTimeout(timer);
  }
}
