/**
 * Confined, bounded Redlib requests — Batch D transport helper.
 *
 * Every non-post tool request goes through this module so the configured base
 * is normalised ONCE, path segments are validated/percent-encoded exactly once
 * and every outbound URL stays inside the configured origin + prefix.
 *
 * Wire contract:
 *  - `redirect: 'manual'` with a bounded redirect policy (301/302/303/307/308,
 *    at most `maxRedirects` hops). Redirect targets must be same-origin, stay
 *    under the configured prefix and never downgrade https -> http; raw
 *    hostile shapes (dot segments, backslashes, encoded separators, controls)
 *    are rejected BEFORE WHATWG normalisation can collapse them.
 *  - One operation-wide `AbortController` (default 30s) covers every request,
 *    redirect and body consumption. `fetchRedlibHtmlPair` runs both requests
 *    on ONE shared controller/deadline and aborts + settles + disposes the
 *    sibling on either failure.
 *  - `node-fetch`'s `size` option caps the FINAL (decompressed) body
 *    (default 5 MiB); oversize/timeout surface as typed errors.
 *  - Non-success, redirect and aborted bodies are disposed before the next
 *    request or before the error is returned.
 *  - A successful HTML document must still look like the page the caller
 *    expected: a recognised Redlib error view (`#error`, from the pinned
 *    `templates/error.html`) or a page without `#column_one` fails. Genuinely
 *    empty listings/collections and an empty wiki body stay successes.
 *
 * `fetch` and `limits` are injectable for tests only; there are no public MCP
 * knobs or environment variables for them.
 */

import * as cheerio from 'cheerio';
import nodeFetch from 'node-fetch';
import type { RequestInit as NodeFetchRequestInit, Response as NodeFetchResponse } from 'node-fetch';
import { rawReferenceShapeError } from './post-reference.js';

/** Minimal shape of `node-fetch`'s default export, injectable in tests. */
export type FetchLike = (url: string, init?: NodeFetchRequestInit) => Promise<NodeFetchResponse>;

export interface RedlibLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxBodyBytes: number;
}

export interface RedlibBase {
  /** Origin + normalised prefix, no trailing slash (e.g. `http://host/internal`). */
  url: string;
  origin: string;
  prefix: string;
  protocol: string;
}

export type PageKind = 'listing' | 'user' | 'wiki';

export interface RequestContext {
  base: RedlibBase;
  fetch?: FetchLike;
  limits?: Partial<RedlibLimits>;
}

export interface RedlibRequest {
  /** Absolute, already-built URL under `context.base`. */
  url: string;
  kind?: PageKind;
}

export type RedlibRequestErrorCode =
  | 'invalid-base'
  | 'invalid-segment'
  | 'http-status'
  | 'unsafe-redirect'
  | 'redirect-loop'
  | 'too-many-redirects'
  | 'timeout'
  | 'too-large'
  | 'network'
  | 'error-page'
  | 'unexpected-structure';

/** Typed transport failure; `status` is the upstream HTTP status when known. */
export class RedlibRequestError extends Error {
  readonly code: RedlibRequestErrorCode;
  readonly status?: number;

  constructor(code: RedlibRequestErrorCode, message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RedlibRequestError';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_LIMITS: RedlibLimits = {
  timeoutMs: 30_000,
  maxRedirects: 5,
  maxBodyBytes: 5 * 1024 * 1024,
};

const REDIRECT_STATUSES = new Set<number>([301, 302, 303, 307, 308]);

const STRUCTURAL_DELIMITERS = /[/\\?#]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u0080-\u009f]/;

function normalizePrefix(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

/** Normalise the configured base exactly once, rejecting unusable config. */
export function normalizeRedlibBase(rawBase: string): RedlibBase {
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    // Never echo the configured value: it could carry credentials.
    throw new RedlibRequestError('invalid-base', 'Invalid Redlib base URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RedlibRequestError('invalid-base', 'Redlib base URL must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new RedlibRequestError('invalid-base', 'Redlib base URL must not contain credentials');
  }
  const prefix = normalizePrefix(url.pathname);
  return {
    url: `${url.origin}${prefix}`,
    origin: url.origin,
    prefix,
    protocol: url.protocol,
  };
}

function describe(what: string): string {
  return `Invalid ${what}`;
}

/**
 * Validate a fixed single-segment name before it reaches the URL.
 * Structural delimiters and controls are refused; everything else is encoded
 * once by the caller. `.`/`..` are refused to prevent dot-segment escape.
 */
function assertSingleSegment(raw: string, what: string): void {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new RedlibRequestError('invalid-segment', `${describe(what)}: segment is empty`);
  }
  if (raw === '.' || raw === '..') {
    throw new RedlibRequestError('invalid-segment', `${describe(what)}: dot segments are not allowed`);
  }
  if (STRUCTURAL_DELIMITERS.test(raw)) {
    throw new RedlibRequestError(
      'invalid-segment',
      `${describe(what)}: segment contains a slash, backslash, query or fragment delimiter`
    );
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    throw new RedlibRequestError('invalid-segment', `${describe(what)}: segment contains control characters`);
  }
}

function encodeOnce(raw: string, what: string): string {
  try {
    return encodeURIComponent(raw);
  } catch {
    throw new RedlibRequestError('invalid-segment', `${describe(what)}: segment cannot be encoded`);
  }
}

/**
 * Encode a subreddit name as ONE path segment, preserving the literal `+`
 * that separates multireddit members (`/r/a+b/hot`, never `/r/a%2Bb/hot`).
 */
export function encodeSubredditName(raw: string): string {
  assertSingleSegment(raw, 'subreddit name');
  return encodeOnce(raw, 'subreddit name').replace(/%2B/g, '+');
}

/** Encode a username as ONE path segment (a `+` is not a separator here). */
export function encodeUserName(raw: string): string {
  assertSingleSegment(raw, 'username');
  return encodeOnce(raw, 'username');
}

/**
 * Encode a documented nested wiki page: split on `/`, validate every segment
 * (nonempty, non-dot, no delimiter/controls) and percent-encode each raw
 * segment once before joining with `/`.
 */
export function encodeWikiPage(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new RedlibRequestError('invalid-segment', 'Invalid wiki page: page is empty');
  }
  const segments = raw.split('/');
  return segments
    .map((segment) => {
      if (segment.length === 0) {
        throw new RedlibRequestError('invalid-segment', 'Invalid wiki page: empty path segment');
      }
      assertSingleSegment(segment, 'wiki page segment');
      return encodeOnce(segment, 'wiki page segment');
    })
    .join('/');
}

/** Build an absolute URL under the normalised base, without double slashes. */
export function redlibUrl(base: RedlibBase, ...segments: string[]): string {
  const suffix = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  return `${base.url}${suffix}`;
}

/** Append a query string when there are parameters. */
export function withQuery(url: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? url : `${url}?${query}`;
}

// Release an unconsumed redirect/error/aborted body before the next request.
function disposeBody(response: NodeFetchResponse): void {
  const body = (response as unknown as { body?: { destroy?: () => void; resume?: () => void } }).body;
  if (!body) return;
  if (typeof body.destroy === 'function') body.destroy();
  else if (typeof body.resume === 'function') body.resume();
}

function mapFetchError(
  error: unknown,
  limits: RedlibLimits,
  signal: AbortSignal,
  timedOut: boolean
): RedlibRequestError {
  const err = error as { type?: string; name?: string; message?: string } | undefined;
  if (timedOut || (signal.aborted && err?.name === 'AbortError')) {
    return new RedlibRequestError('timeout', `Fetch exceeded the ${limits.timeoutMs}ms timeout`, undefined, error);
  }
  if (err?.type === 'max-size') {
    return new RedlibRequestError('too-large', `Response body exceeded ${limits.maxBodyBytes} bytes`, undefined, error);
  }
  if (err?.name === 'AbortError' || err?.type === 'aborted') {
    return new RedlibRequestError('network', 'Request was aborted', undefined, error);
  }
  return new RedlibRequestError('network', err?.message ?? String(error), undefined, error);
}

function pathIsConfined(pathname: string, prefix: string): boolean {
  if (prefix === '') return pathname.startsWith('/');
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Resolve and validate a redirect `Location`. The raw shape is gated with the
 * same hostile-input rules used for post references BEFORE WHATWG resolution,
 * then origin/prefix/scheme confinement is enforced explicitly.
 */
function resolveRedirect(location: string, currentUrl: string, base: RedlibBase): string {
  const shapeError = rawReferenceShapeError(location);
  if (shapeError !== undefined) {
    throw new RedlibRequestError('unsafe-redirect', `Unsafe redirect target rejected (${shapeError})`);
  }
  let resolved: URL;
  try {
    resolved = new URL(location, currentUrl);
  } catch {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect Location is not a valid URL');
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect target must use http or https');
  }
  if (base.protocol === 'https:' && resolved.protocol === 'http:') {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect downgrades to an insecure scheme');
  }
  if (resolved.origin !== base.origin) {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect target is outside the configured origin');
  }
  if (resolved.username !== '' || resolved.password !== '') {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect target must not contain credentials');
  }
  if (!pathIsConfined(resolved.pathname, base.prefix)) {
    throw new RedlibRequestError('unsafe-redirect', 'Redirect target is outside the configured base path');
  }
  return resolved.toString();
}

interface OpenResult {
  response: NodeFetchResponse;
  url: string;
}

/** Issue one request chain with manual redirects; the body stays consumable. */
async function openResponse(
  request: RedlibRequest,
  base: RedlibBase,
  fetchImpl: FetchLike,
  limits: RedlibLimits,
  signal: AbortSignal,
  timedOut: () => boolean
): Promise<OpenResult> {
  let currentUrl = request.url;
  const visited = new Set<string>();
  let hops = 0;

  for (;;) {
    if (visited.has(currentUrl)) {
      throw new RedlibRequestError('redirect-loop', `Redirect loop detected at ${currentUrl}`);
    }
    visited.add(currentUrl);

    let response: NodeFetchResponse;
    try {
      response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal,
        size: limits.maxBodyBytes,
      });
    } catch (error) {
      throw mapFetchError(error, limits, signal, timedOut());
    }

    const status = response.status;

    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers.get('location');
      disposeBody(response);
      if (location === null || location === '') {
        throw new RedlibRequestError('unsafe-redirect', 'Redirect response is missing a Location header');
      }
      const target = resolveRedirect(location, currentUrl, base);
      hops += 1;
      if (hops > limits.maxRedirects) {
        throw new RedlibRequestError('too-many-redirects', `Exceeded the ${limits.maxRedirects}-redirect limit`);
      }
      currentUrl = target;
      continue;
    }

    if (status < 200 || status >= 300) {
      disposeBody(response);
      const reason = response.statusText ? `: ${response.statusText}` : '';
      throw new RedlibRequestError('http-status', `Redlib returned ${status}${reason}`, status);
    }

    return { response, url: currentUrl };
  }
}

const mergeLimits = (overrides: Partial<RedlibLimits> | undefined): RedlibLimits => ({
  ...DEFAULT_LIMITS,
  ...overrides,
});

function assertUsablePage(html: string, kind: PageKind): void {
  const $ = cheerio.load(html);

  // The pinned templates/error.html renders <div id="error"><h1>…</h1>…
  // and every real page template renders <div id="column_one">. A body inside
  // content can carry an `id="error"` element, so presence of the content
  // column wins; only a document without it can be an error/gate view.
  if ($('#column_one').length === 0) {
    const errorView = $('#error');
    if (errorView.length > 0) {
      const message = errorView.find('h1').first().text().trim().slice(0, 200);
      throw new RedlibRequestError(
        'error-page',
        message === '' ? 'Redlib returned an error page' : `Redlib returned an error page: ${message}`
      );
    }
    throw new RedlibRequestError(
      'unexpected-structure',
      'Redlib page is missing the expected content column'
    );
  }

  if (kind === 'wiki' && $('#wiki').length === 0) {
    throw new RedlibRequestError(
      'unexpected-structure',
      'Redlib wiki page is missing the expected wiki container'
    );
  }
}

async function consume(
  response: NodeFetchResponse,
  limits: RedlibLimits,
  signal: AbortSignal,
  timedOut: () => boolean
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    disposeBody(response);
    throw mapFetchError(error, limits, signal, timedOut());
  }
}

/** Fetch one page within its own operation budget. */
export async function fetchRedlibHtml(context: RequestContext, request: RedlibRequest): Promise<string> {
  const limits = mergeLimits(context.limits);
  const fetchImpl: FetchLike = context.fetch ?? (nodeFetch as unknown as FetchLike);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);

  try {
    const { response } = await openResponse(
      request,
      context.base,
      fetchImpl,
      limits,
      controller.signal,
      () => timedOut
    );
    const html = await consume(response, limits, controller.signal, () => timedOut);
    if (request.kind !== undefined) assertUsablePage(html, request.kind);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch two pages on ONE shared operation budget (the two subreddit-info
 * requests). On either failure the sibling is aborted, both requests are
 * awaited (settled) and every unconsumed body is disposed before the first
 * error is returned — so a pending sibling cannot outlive the operation.
 */
export async function fetchRedlibHtmlPair(
  context: RequestContext,
  first: RedlibRequest,
  second: RedlibRequest
): Promise<[string, string]> {
  const limits = mergeLimits(context.limits);
  const fetchImpl: FetchLike = context.fetch ?? (nodeFetch as unknown as FetchLike);
  const controller = new AbortController();
  let timedOut = false;
  let firstError: unknown;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);

  // One independent pipeline per page: open, consume the body and validate the
  // page without waiting for the peer. A status/network/body/size/structure
  // failure is retained BEFORE the peer is aborted, so the real cause is never
  // replaced by the sibling's abort/timeout.
  const run = async (request: RedlibRequest): Promise<string> => {
    try {
      const { response } = await openResponse(
        request,
        context.base,
        fetchImpl,
        limits,
        controller.signal,
        () => timedOut
      );
      const html = await consume(response, limits, controller.signal, () => timedOut);
      if (request.kind !== undefined) assertUsablePage(html, request.kind);
      return html;
    } catch (error) {
      if (firstError === undefined) {
        firstError = error;
        controller.abort();
      }
      throw error;
    }
  };

  try {
    // `allSettled` waits for both pipelines, so a pending sibling cannot
    // outlive the operation; each failure path has already disposed its body.
    const settled = await Promise.allSettled([run(first), run(second)]);
    if (firstError !== undefined) {
      throw firstError;
    }
    return [
      (settled[0] as PromiseFulfilledResult<string>).value,
      (settled[1] as PromiseFulfilledResult<string>).value,
    ];
  } finally {
    clearTimeout(timer);
  }
}
