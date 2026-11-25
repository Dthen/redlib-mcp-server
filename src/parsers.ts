import * as cheerio from 'cheerio';

export interface FlairData {
  text: string;
  text_color?: string;
  bg_color?: string;
  emoji_urls: string[];
  filter_url: string;
}

export interface PostListItem {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number | null;
  commentCount: number;
  permalink?: string;
  flair?: FlairData;
  created_utc?: string;
  created_relative?: string;
  score_exact?: number;
  score_hidden?: boolean;
  stickied?: boolean;
  nsfw?: boolean;
  spoiler?: boolean;
  post_type?: 'self' | 'link' | 'image' | 'video' | 'gallery';
  author_flair?: 'moderator' | 'admin';
  thumbnail_url?: string;
  external_url?: string;
}

export type MediaItem = { type: 'image' | 'gif' | 'video'; url: string };

export interface CommentData {
  id: string;
  author: string;
  text: string;
  score: number | null;
  score_hidden?: boolean;
  author_is_op: boolean;
  created_utc?: string;
  created_relative?: string;
  permalink?: string;
  media?: MediaItem[];
  depth: number;
  replies?: CommentData[];
}

export interface PostDetails {
  id?: string;
  title: string;
  author: string;
  subreddit: string;
  score: number | null;
  body: string;
  commentCount: number;
  comments: CommentData[];
  permalink?: string;
  flair?: FlairData;
  created_utc?: string;
  created_relative?: string;
  score_exact?: number;
  score_hidden?: boolean;
  media?: MediaItem[];
  nsfw?: boolean;
  spoiler?: boolean;
  post_type?: 'self' | 'link' | 'image' | 'video' | 'gallery';
  external_url?: string;
  author_flair?: 'moderator' | 'admin';
}

/**
 * Extracts flair data from a post element using the cheerio root.
 */
function extractFlair($: cheerio.CheerioAPI, $postEl: cheerio.Cheerio<any>, publicBaseUrl: string = "https://www.reddit.com", baseUrl: string = "http://localhost:8080"): FlairData | undefined {
  const $flair = $postEl.find('.post_title a.post_flair').first();
  return extractFlairFromAnchor($, $flair, publicBaseUrl, baseUrl);
}

/**
 * Extracts flair data from a post_flair anchor element.
 * filter_url is made absolute against publicBaseUrl (it is a navigation link
 * that works on reddit.com, unlike media URLs which the instance proxies).
 * emoji_urls are made absolute against baseUrl (the instance proxies them).
 */
function extractFlairFromAnchor($: cheerio.CheerioAPI, $flair: cheerio.Cheerio<any>, publicBaseUrl: string = "https://www.reddit.com", baseUrl: string = "http://localhost:8080"): FlairData | undefined {
  if (!$flair.length) return undefined;

  const text = $flair.find('span:not(.emoji)').map((_, s) => $(s).text()).get().join(' ').trim();
  const styleAttr = $flair.attr('style') || '';
  // Property-boundary match: `color` must be its own declaration, so the
  // `color` inside `background-color` is not mistaken for the text color
  // (and `background` does not match `background-color`/`background-image`).
  const text_color = styleAttr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
  const bg_color = styleAttr.match(/(?:^|;)\s*background\s*:\s*([^;]+)/i)?.[1]?.trim();
  const emoji_urls = $flair.find('span.emoji').map((_, s) => {
    const sStyle = $(s).attr('style') || '';
    const match = sStyle.match(/background-image:\s*url\('?([^')]+)'?\)/);
    return match ? absoluteUrl(match[1], baseUrl) : '';
  }).get().filter(Boolean);
  const filterHref = $flair.attr('href') || '';
  const filter_url = absolutePublicUrl(filterHref, publicBaseUrl);

  return {
    text,
    ...(text_color ? { text_color } : {}),
    ...(bg_color ? { bg_color } : {}),
    emoji_urls,
    filter_url,
  };
}

/**
 * Parses a compact score like "68.6k" or "1.2m" into an integer
 * (68604 / 1200000). Returns undefined when the text is not a parseable score.
 */
function parseCompactScore(text: string): number | undefined {
  // Anchored both ends: the full text must be a score (callers strip the
  // ' Upvotes' label first), so garbage like '12abc' is rejected instead of
  // prefix-matching '12'. A leading dot is accepted ('.5k' → 500).
  const match = text.replace(/,/g, '').trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))([km])?$/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const suffix = match[2] ? match[2].toLowerCase() : '';
  if (suffix === 'k') return Math.round(value * 1000);
  if (suffix === 'm') return Math.round(value * 1000000);
  return Math.round(value);
}

/**
 * Extracts just the numeric score text from a score element. Instead of
 * mutating a clone, collects parse candidates and returns the first one that
 * parses as a compact score:
 *   1. the element's overall text (plain text, inline <b>12</b>, nested spans),
 *   2. root-level text nodes (the "68.6k" in '68.6k <span class="label">Upvotes</span>'),
 *   3. every LEAF element's text (an element with no element children — its
 *      .text() is its own text, so a numeric leaf like <b>12</b> inside a
 *      wrapper whose text mixes in label words still survives).
 * Guarantee: a numeric leaf inside a mixed-text wrapper is parsed; text that
 * no candidate can parse (e.g. '12abc') yields nothing.
 */
function compactScoreText($: cheerio.CheerioAPI, $score: cheerio.Cheerio<any>): string {
  const $clone = $score.clone();
  const candidates: string[] = [$clone.text()];
  const root = $clone.get(0);
  if (root) {
    for (const node of root.childNodes) {
      if (node.type === 'text' && node.data) candidates.push(node.data);
    }
  }
  $clone.find('*').each((_i, el) => {
    const $el = $(el);
    if ($el.children().length === 0) candidates.push($el.text());
  });
  for (const candidate of candidates) {
    if (parseCompactScore(candidate) !== undefined) return candidate;
  }
  return $clone.text();
}

/**
 * Parses a score element (default .post_score, pass '.comment_score' for comments).
 *
 * Redlib renders hidden scores (search pages, removed scores) as
 * `<div class="post_score" title="Hidden"> • <span class="label"> Upvotes</span></div>` —
 * only then is `score_hidden: true` emitted (case-insensitive, so title="hidden"
 * counts too; it is a claim about Reddit's behavior).
 * When the title attribute holds a real number it is preferred as the primary
 * score and also returned as `score_exact` — Redlib renders compact scores like
 * "68.6k" with the exact value in the title (title="68604" → 68604). Otherwise
 * the label-stripped text is parsed with an anchored k/m-suffix regex
 * ("68.6k Upvotes" → 68600, "1.2m" → 1200000, ".5k" → 500, "12abc" → null).
 * Absent or unparseable markup yields `score: null` WITHOUT a fabricated
 * `score_hidden`.
 */
function parseScore($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, selector: string = '.post_score'): { score: number | null; score_hidden?: boolean; score_exact?: number } {
  const $score = $el.find(selector).first();
  const title = $score.attr('title');
  // Whitespace-padded titles (' hidden ') count too, matching the numeric-title
  // trimming below.
  if (title?.trim().toLowerCase() === 'hidden') {
    return { score: null, score_hidden: true };
  }
  const titleDigits = title ? title.replace(/,/g, '').trim() : '';
  const exact = title !== undefined && /^-?\d+$/.test(titleDigits) ? parseInt(titleDigits, 10) : undefined;
  if (exact !== undefined) {
    return { score: exact, score_exact: exact };
  }
  const parsed = parseCompactScore(compactScoreText($, $score));
  if (parsed === undefined) return { score: null };
  return { score: parsed };
}

/**
 * Normalizes a redlib-rendered subreddit label to the bare subreddit or
 * username. Strips the 'r/' subreddit prefix, the 'u/' user prefix, and the
 * 'u_' prefix of the pseudo-subreddit redlib renders for user-profile posts
 * (r/u_spez → spez). Anchored so real names containing 'u_' are untouched.
 */
function normalizeSubredditLabel(text: string): string {
  return text.trim().replace(/^r\//, '').replace(/^u_/, '').replace(/^u\//, '').trim();
}

/**
 * True when the value carries any RFC 3986 scheme (`http:`, `https:`, `ftp:`,
 * `mailto:`, …). Scheme-bearing destinations are returned by the parsers as
 * data only; nothing fetches or follows them.
 */
function hasUrlScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url.trim());
}

/**
 * Resolves a list/detail destination (`external_url`) against the public base.
 * Scheme-bearing destinations and protocol-relative URLs are returned verbatim;
 * only path-relative values are prefixed with the public base. This is passive
 * returned data and never broadens request/redirect policy.
 */
function resolveDestinationUrl(url: string, publicBaseUrl: string): string {
  const value = url.trim();
  if (!value || hasUrlScheme(value) || value.startsWith('//')) return value;
  return `${publicBaseUrl.replace(/\/+$/, '')}${value.startsWith('/') ? '' : '/'}${value}`;
}

/**
 * Canonical destination identity for the negative emission guard.
 *
 * WHATWG URL parsing normalizes scheme/host case and default ports, and
 * resolves scheme-relative input against `base`; path case, query values and
 * fragments are preserved. Only trailing slashes on the path are ignored, so a
 * comment/fragment destination is never collapsed into its thread permalink.
 * This is pure string parsing: no request is made and no redirect or
 * server-specific alias is inferred.
 */
function destinationIdentity(url: string, base: string): string | undefined {
  try {
    const parsed = new URL(url, base);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

/**
 * True when both destination strings denote the same URL under
 * `destinationIdentity`. Unparseable values are never treated as identical, so
 * an unreadable destination is reported rather than silently dropped.
 */
function sameDestination(a: string, b: string, base: string): boolean {
  const identityA = destinationIdentity(a, base);
  const identityB = destinationIdentity(b, base);
  return identityA !== undefined && identityA === identityB;
}

/**
 * Post type asserted by a list thumbnail anchor's own label.
 *
 * The pinned template renders the post type for every non-link post and the
 * destination domain for link posts, so:
 *   - `self` → self, and the legacy `self.<subreddit>` domain label → self when
 *     its href is a relative Reddit permalink or the absolute/protocol-relative
 *     spelling of this post's own permalink; a `self.` label whose scheme-bearing
 *     href resolves to a different destination (self.io, self.com, another
 *     thread) is an external destination → link,
 *   - `gallery` / `image` / `video` / `gif` → that type (`gif` posts are typed
 *     video in the same union used for `.post_media_video`),
 *   - any other non-empty label is a destination domain → link.
 * An empty or absent label carries no type/domain evidence and returns
 * undefined so the caller can fall back to the href shape.
 */
function thumbnailLabelPostType(
  $anchor: cheerio.Cheerio<any>,
  publicBaseUrl: string,
  permalink: string | undefined
): 'self' | 'link' | 'image' | 'video' | 'gallery' | undefined {
  const label = $anchor.find('span').first().text().trim().toLowerCase();
  if (!label) return undefined;
  if (label === 'self') return 'self';
  if (label.startsWith('self.')) {
    const href = ($anchor.attr('href') || '').trim();
    if (!hasUrlScheme(href) && !href.startsWith('//')) return 'self';
    // The absolute spelling of this post's own permalink is still the same self
    // post; only a genuinely different destination stays a link target.
    return permalink && sameDestination(href, permalink, publicBaseUrl) ? 'self' : 'link';
  }
  if (label === 'gallery') return 'gallery';
  if (label === 'image') return 'image';
  if (label === 'video' || label === 'gif') return 'video';
  return 'link';
}

/**
 * Detects the post type based on DOM elements on the post element.
 * Handles both list markup (thumbnail labels/anchors, post previews) and the
 * detail template (media containers, #post_url, the body div).
 */
function determinePostType(
  $el: cheerio.Cheerio<any>,
  publicBaseUrl: string,
  permalink: string | undefined
): 'self' | 'link' | 'image' | 'video' | 'gallery' | undefined {
  // List thumbnails label their own type/domain; detail pages wrap every
  // gallery image in a .gallery container.
  const $thumbnail = $el.find('a.post_thumbnail').first();
  const labelType = $thumbnail.length ? thumbnailLabelPostType($thumbnail, publicBaseUrl, permalink) : undefined;
  if (labelType === 'gallery') {
    return 'gallery';
  }
  if ($el.find('.gallery').length > 0) {
    return 'gallery';
  }

  // Check for video
  if ($el.find('.post_media_video').length > 0) {
    return 'video';
  }

  // Check for image (direct media image)
  if ($el.find('.post_media_image').length > 0) {
    return 'image';
  }

  // Check for link (detail pages render the destination in #post_url)
  if ($el.find('#post_url').length > 0) {
    return 'link';
  }

  // Remaining list labels: a type token stays that type and a domain label is a
  // link destination. The label wins over the href shape, so an absolute
  // destination is never mistaken for a self permalink (and vice versa).
  if (labelType) {
    return labelType;
  }

  // No label evidence (older captures render an empty span): fall back to the
  // href shape. Redlib renders post permalinks relative, so an absolute
  // thumbnail href is a destination; a relative href under /comments/ is
  // treated as the post's own permalink.
  if ($thumbnail.length) {
    const href = ($thumbnail.attr('href') || '').trim();
    if (isAbsoluteUrl(href)) return 'link';
    if (href.includes('/comments/')) return 'self';
    if (href) return 'link';
  }

  // Check for self post: list items carry the preview body; on detail pages the
  // body container is the last remaining evidence. redlib renders
  // <div class="post_body"> for every detail post type (utils.html:156-159), so
  // this only decides pages where no media container and no #post_url exist;
  // self is the closed-set inference there, and a page with no body either
  // stays absent (markup redlib does not emit).
  if ($el.find('.post_body.post_preview').length > 0) {
    return 'self';
  }
  if ($el.find('.post_body').length > 0) {
    return 'self';
  }

  return undefined;
}

/**
 * Exact comment count from the `.post_comments` title attribute, e.g.
 * title="3426 comments" → 3426. Returns undefined when the attribute is
 * absent or not a count, so the caller can fall back to display text.
 */
function parseExactCommentCount(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match = title.trim().match(/^(\d[\d,]*)\s+comments?$/i);
  if (!match) return undefined;
  const digits = match[1].replace(/,/g, '');
  if (!/^\d+$/.test(digits)) return undefined;
  return parseInt(digits, 10);
}

/**
 * Supported visible comment-count text: plain digits ("857"), comma-grouped
 * digits ("1,234") or a compact k/m value ("3.4k"). Returns undefined for
 * anything else so the caller keeps the previous first-integer semantics.
 */
function parseDisplayCommentCount(text: string): number | undefined {
  const body = text.trim().replace(/\s*comments?$/i, '').trim();
  if (!body) return undefined;
  if (/^\d+$/.test(body)) return parseInt(body, 10);
  if (/^\d{1,3}(?:,\d{3})+$/.test(body)) return parseInt(body.replace(/,/g, ''), 10);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)\s*[km]$/i.test(body)) return undefined;
  return parseCompactScore(body.replace(/\s+/g, ''));
}

/**
 * Comment count for a list post: prefer the exact `.post_comments` title
 * attribute, then a supported compact/comma display count, else the previous
 * first-integer text behaviour (0 when nothing parses).
 */
function parseCommentCount($el: cheerio.Cheerio<any>): number {
  const $comments = $el.find('.post_comments').first();
  const exact = parseExactCommentCount($comments.attr('title'));
  if (exact !== undefined) return exact;
  const text = $comments.text().trim();
  const display = parseDisplayCommentCount(text);
  if (display !== undefined) return display;
  const legacy = text.match(/(\d+)/);
  return legacy ? parseInt(legacy[1], 10) : 0;
}

/** A text node made up solely of whitespace-separated NSFW/Spoiler flag tokens. */
const BARE_FLAG_TOKENS = /^\s*(?:NSFW|Spoiler)(?:\s+(?:NSFW|Spoiler))*\s*$/i;

interface TitleFlagInfo {
  nsfw: boolean;
  spoiler: boolean;
  /** The metadata element/text nodes found (used to exclude them from titles). */
  metadataNodes: any[];
}

/**
 * Detects NSFW/spoiler metadata inside a scoped `.post_title` container.
 *
 * Positive markup is `small.nsfw`/`small.spoiler` (current redlib) and legacy
 * `.nsfw`/`.spoiler` elements, but only outside the actual title link and the
 * flair anchor. A bare flag word is accepted only as a direct text-node child
 * of the title container, only when a non-flair title anchor exists, and only
 * when the node is nothing but flag tokens/whitespace. Plain title words (or
 * flair text) are never flags.
 */
function analyzeTitleFlags($: cheerio.CheerioAPI, $title: cheerio.Cheerio<any>): TitleFlagInfo {
  const info: TitleFlagInfo = { nsfw: false, spoiler: false, metadataNodes: [] };
  if (!$title.length) return info;

  const $titleAnchor = $title.find('a').not('.post_flair').first();
  const titleAnchorNode = $titleAnchor.get(0);

  $title.find('small.nsfw, small.spoiler, .nsfw, .spoiler').each((_i, el) => {
    const $el = $(el);
    // The actual title link and the flair anchor are structural, never flag
    // metadata, even when they themselves carry a legacy .nsfw/.spoiler class.
    if (titleAnchorNode && el === titleAnchorNode) return;
    if ($el.hasClass('post_flair')) return;
    let insideFlair = false;
    let insideTitleAnchor = false;
    $el.parents('a').each((_j, anchor) => {
      if ($(anchor).hasClass('post_flair')) insideFlair = true;
      if (titleAnchorNode && anchor === titleAnchorNode) insideTitleAnchor = true;
    });
    if (insideFlair || insideTitleAnchor) return;
    if ($el.hasClass('nsfw')) info.nsfw = true;
    if ($el.hasClass('spoiler')) info.spoiler = true;
    info.metadataNodes.push($el.get(0));
  });

  if (titleAnchorNode) {
    $title.contents().each((_i, node) => {
      if (node.type !== 'text') return;
      const data = (node as any).data || '';
      if (!BARE_FLAG_TOKENS.test(data)) return;
      let flagged = false;
      if (/\bNSFW\b/i.test(data)) { info.nsfw = true; flagged = true; }
      if (/\bSpoiler\b/i.test(data)) { info.spoiler = true; flagged = true; }
      if (flagged) info.metadataNodes.push(node);
    });
  }

  return info;
}

/**
 * Text of a title container excluding the flair anchor and the identified flag
 * metadata nodes; actual title words (including words like "NSFW") are kept.
 */
function titleTextExcluding($: cheerio.CheerioAPI, $title: cheerio.Cheerio<any>, excluded: any[]): string {
  const excludedSet = new Set(excluded);
  let text = '';
  const walk = (node: any) => {
    if (excludedSet.has(node)) return;
    if (node.type === 'text') {
      text += node.data || '';
      return;
    }
    if (node.type !== 'tag') return;
    if (node.name === 'a' && $(node).hasClass('post_flair')) return;
    for (const child of node.children || []) walk(child);
  };
  const root = $title.get(0);
  for (const child of root?.children || []) walk(child);
  return text.trim();
}

/**
 * Determines author flair from post_author element classes.
 */
function extractAuthorFlair($el: cheerio.Cheerio<any>): 'moderator' | 'admin' | undefined {
  const $author = $el.find('.post_author').first();
  if ($author.hasClass('moderator')) return 'moderator';
  if ($author.hasClass('admin')) return 'admin';
  return undefined;
}

/**
 * Returns true for absolute http(s) URLs (scheme check is case-insensitive).
 */
function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Makes a URL absolute against baseUrl (the redlib instance proxies the bytes).
 * Absolute http(s) URLs and protocol-relative ('//host/path') URLs are returned
 * as-is; a trailing slash on baseUrl is stripped so callers are safe regardless
 * of env value.
 */
function absoluteUrl(url: string, baseUrl: string): string {
  // Empty/whitespace URLs are returned unchanged — never prefixed into '<base>/'.
  if (!url.trim() || isAbsoluteUrl(url) || url.startsWith('//')) return url;
  return `${baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Makes a navigation URL absolute against the public base URL (e.g.
 * https://www.reddit.com). Same guards as absoluteUrl.
 */
function absolutePublicUrl(url: string, publicBaseUrl: string): string {
  // Empty/whitespace URLs are returned unchanged — never prefixed into '<base>/'.
  if (!url.trim() || isAbsoluteUrl(url) || url.startsWith('//')) return url;
  return `${publicBaseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Classifies a media URL: 'gif' only when the path (after stripping any query
 * string / fragment) ends with '.gif', otherwise 'image'. The extension check
 * avoids false positives on URLs that merely contain 'gif' (e.g. giphy.com).
 */
function mediaType(url: string): MediaItem['type'] {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  return path.endsWith('.gif') ? 'gif' : 'image';
}

/**
 * Extracts media (images, gifs, videos) from a cheerio scope — a comment body
 * or the post element. Redlib renders image/gif content as
 * <figure><a href="..."><img src="..."/></a></figure> and video content as
 * <video><source src="..."/></video> (or <video src="..."/>).
 *
 * For a figure exactly ONE media item is emitted, preferring the img[src]
 * (proxied preview) over the a[href] (external full-size), so one image never
 * yields two media items. Bare <img> elements outside figures, post image
 * anchors (a.post_media_image) and both video forms are also captured. URLs
 * are made absolute against baseUrl (the instance proxies them).
 */
function extractMedia($: cheerio.CheerioAPI, $scope: cheerio.Cheerio<any>, baseUrl: string): MediaItem[] {
  const media: MediaItem[] = [];
  const push = (type: MediaItem['type'], url: string) => {
    const abs = absoluteUrl(url, baseUrl);
    if (!media.some(m => m.url === abs)) media.push({ type, url: abs });
  };

  $scope.find('figure').each((_i, el) => {
    const $fig = $(el);
    const imgSrc = $fig.find('img[src]').first().attr('src');
    const href = $fig.find('a[href]').first().attr('href');
    // A figure that wraps a <video> carries that video asset: its anchor href
    // is the video's own source, so it must not be reported as an image. The
    // video branch below emits the single, correctly typed item. A genuine
    // <img> in the same figure is still reported.
    const url = imgSrc || ($fig.find('video').length > 0 ? '' : href) || '';
    if (!url) return;
    // Classify by the MOST specific signal: if either the proxied img or the
    // anchor href is a .gif, the media is a gif (a static .jpg preview img can
    // sit next to a .gif href). The img src stays the emitted URL (proxied preview).
    const type = mediaType(imgSrc || '') === 'gif' || mediaType(href || '') === 'gif' ? 'gif' : 'image';
    push(type, url);
  });
  $scope.find('a.post_media_image').each((_i, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const imgSrc = $a.find('img[src]').first().attr('src') || '';
    // Prefer the anchor href (full-size), fall back to the inner img[src]
    // (proxied preview) when the href is missing/empty; skip only when both are.
    const url = href || imgSrc;
    if (!url) return;
    push(mediaType(url), url);
  });
  // Bare imgs: skip imgs handled by their own branches (figure and
  // a.post_media_image), so one image never yields two media items.
  $scope.find('img[src]').not('figure img, a.post_media_image img').each((_i, el) => {
    const src = $(el).attr('src') || '';
    if (src) push(mediaType(src), src);
  });
  // One logical media item per video: the element's own src, else its MP4
  // rendition, else the first usable source. Two <source> tags of one video
  // (e.g. HLS + MP4) are renditions of the same asset, not distinct media, so
  // they never become two items; distinct <video> elements are never merged.
  $scope.find('video').each((_i, el) => {
    const $video = $(el);
    const direct = ($video.attr('src') || '').trim();
    if (direct) {
      media.push({ type: 'video', url: absoluteUrl(direct, baseUrl) });
      return;
    }
    let firstUsable = '';
    let mp4 = '';
    $video.find('source[src]').each((_j, source) => {
      const $source = $(source);
      const src = ($source.attr('src') || '').trim();
      if (!src) return;
      if (!firstUsable) firstUsable = src;
      const type = ($source.attr('type') || '').trim().toLowerCase();
      if (!mp4 && (type === 'video/mp4' || /\.mp4(?:[?#]|$)/i.test(src))) mp4 = src;
    });
    const chosen = mp4 || firstUsable;
    if (chosen) media.push({ type: 'video', url: absoluteUrl(chosen, baseUrl) });
  });
  return media;
}

/**
 * Parses ONE post element (.post) into a PostListItem.
 * Shared by parsePostList and the parseUserProfile posts loop.
 */
function parsePostElement($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, baseUrl: string, publicBaseUrl: string): PostListItem | undefined {
  // Extract flair if present
  const flair = extractFlair($, $el, publicBaseUrl, baseUrl);

  // Skip flair links — find the first non-flair <a> for the real title
  const $titleLink = $el.find('.post_title a').not('.post_flair').first();
  const title = $titleLink.text().trim();
  const href = $titleLink.attr('href') || '';

  // Get post ID from the div's id attribute (most reliable)
  let id = $el.attr('id') || '';

  // Fallback: extract from href if id attribute is missing
  if (!id) {
    const idMatch = href.match(/\/comments\/([a-z0-9]+)/i);
    id = idMatch ? idMatch[1] : '';
  }

  if (!id || !title) return undefined;

  const subreddit = normalizeSubredditLabel($el.find('.post_subreddit').text());
  const author = $el.find('.post_author').text().trim();
  const { score, score_hidden, score_exact } = parseScore($, $el);
  const commentCount = parseCommentCount($el);

  // Extract created timestamps from <span class="created">
  const $created = $el.find('.post_header span.created').first();
  const created_utc = $created.attr('title')?.trim() || undefined;
  const created_relative = $created.text().trim() || undefined;

  // Extract new metadata fields
  const stickied = $el.hasClass('stickied');
  const { nsfw, spoiler } = analyzeTitleFlags($, $el.find('.post_title').first());
  const author_flair = extractAuthorFlair($el);

  // Public permalink of this post (title anchor). Also the negative guard for
  // destination emission below.
  const permalink = href.trim() ? absolutePublicUrl(href, publicBaseUrl) : undefined;
  // Classification needs the permalink so an absolute spelling of this post's
  // own href is recognised as the same post, not a destination.
  const post_type = determinePostType($el, publicBaseUrl, permalink);

  // Extract thumbnail URL from post_thumbnail (svg image href or img src)
  const $thumbnail = $el.find('a.post_thumbnail').first();
  let thumbnail_url: string | undefined;
  let external_url: string | undefined;
  if ($thumbnail.length) {
    const thumbHref = ($thumbnail.attr('href') || '').trim();
    // The thumbnail anchor holds a destination only for link posts (see
    // determinePostType); every other type renders the post's own permalink
    // there, which must never be reported as a destination. A legacy capture
    // can also label a non-link post with a media domain while still pointing
    // at the post's own permalink, so the resolved destination is compared with
    // the permalink as a negative guard before emission.
    if (thumbHref && post_type === 'link') {
      const destination = resolveDestinationUrl(thumbHref, publicBaseUrl);
      if (!(permalink && sameDestination(destination, permalink, publicBaseUrl))) {
        external_url = destination;
      }
    }
    // thumbnail_url: from svg image href or img src (absolute against the instance base)
    const svgImageHref = $thumbnail.find('svg image').attr('href');
    const imgSrc = $thumbnail.find('img').attr('src');
    const thumbSrc = svgImageHref || imgSrc || undefined;
    thumbnail_url = thumbSrc ? absoluteUrl(thumbSrc, baseUrl) : undefined;
  }

  return {
    id,
    title,
    subreddit,
    author,
    score,
    commentCount,
    ...(permalink ? { permalink } : {}),
    ...(flair ? { flair } : {}),
    ...(created_utc ? { created_utc } : {}),
    ...(created_relative ? { created_relative } : {}),
    ...(score_exact !== undefined ? { score_exact } : {}),
    ...(score_hidden ? { score_hidden } : {}),
    ...(stickied ? { stickied } : {}),
    ...(nsfw ? { nsfw } : {}),
    ...(spoiler ? { spoiler } : {}),
    ...(post_type ? { post_type } : {}),
    ...(author_flair ? { author_flair } : {}),
    ...(thumbnail_url ? { thumbnail_url } : {}),
    ...(external_url ? { external_url } : {}),
  };
}

/**
 * Parses Redlib search/hot results HTML into structured JSON
 */
export function parsePostList(html: string, baseUrl: string = "http://localhost:8080", publicBaseUrl: string = "https://www.reddit.com"): PostListItem[] {
  const $ = cheerio.load(html);
  const results: PostListItem[] = [];

  $('.post').each((_i: number, el: any) => {
    const post = parsePostElement($, $(el), baseUrl, publicBaseUrl);
    if (post) results.push(post);
  });

  return results;
}

/**
 * Parses individual Redlib post + comments HTML into structured JSON
 */
export interface SubredditSearchResult {
  name: string;
  subscribers: string;
  description: string;
}

/**
 * Parses Redlib subreddit search results HTML into structured JSON
 */
export function parseSubredditSearch(html: string): SubredditSearchResult[] {
  const $ = cheerio.load(html);
  const results: SubredditSearchResult[] = [];

  $('#search_subreddits .search_subreddit').each((_i: number, el: any) => {
    const $el = $(el);
    const name = $el.find('.search_subreddit_name').text().trim().replace(/^r\//, '');
    const subscribers = $el.find('.search_subreddit_members').text().trim();
    const description = $el.find('.search_subreddit_description').text().trim();

    if (name) {
      results.push({ name, subscribers, description });
    }
  });

  return results;
}

export interface CommentSearchItem {
  text: string;
  author: string;
  score: number | null;
  score_hidden?: boolean;
  linkTitle?: string;
  permalink?: string;
  parent_permalink?: string;
  subreddit?: string;
  created_utc?: string;
  created_relative?: string;
  media?: MediaItem[];
}

/**
 * Recognised Reddit-style comment/post path inside a permalink: an optional
 * `/r/<sub>/` prefix followed by `/comments/<post-id>`, where the post ID
 * segment ends at the next slash or at the end of the path. Anything else
 * (e.g. redlib's profile-comment path `/user/<name>/comments/…`, an author
 * page or an arbitrary destination) does not establish a parent post.
 */
const REDDIT_COMMENT_PATH = /^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i;

/**
 * Parent post permalink of a comment permalink, or undefined when the parent
 * cannot be established.
 *
 * The derivation is explicit and conservative: parse the resolved permalink,
 * keep everything up to and including the post ID, and drop the comment-specific
 * segments (title slug, comment id), the query string and the fragment. The
 * origin of the supplied permalink is preserved; no ID is invented and no
 * request is made.
 */
function deriveParentPermalink(permalink: string | undefined): string | undefined {
  if (!permalink) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(permalink);
  } catch {
    return undefined;
  }
  const match = parsed.pathname.match(REDDIT_COMMENT_PATH);
  if (!match) return undefined;
  const throughPost = `${parsed.protocol}//${parsed.host}${parsed.pathname.slice(0, match[0].length)}`;
  return throughPost.endsWith('/') ? throughPost : `${throughPost}/`;
}

/**
 * Parses Redlib comment-search results (#search_results_comments →
 * .comment.user-comment) into a flat list, in document order.
 *
 * Fields are frozen at text/author/score plus the optional values the markup
 * supplies. `author` is the displayed text, exactly as detail comments keep it
 * ("u/name"). `text` comes from the comment body's rendered markdown when one
 * is present, else from the body container. `permalink` is the supplied
 * comment link resolved against the public base and `parent_permalink` is the
 * derived parent post permalink (absent when it cannot be established). No
 * `id` is invented: the search markup does not carry one.
 */
export function parseCommentSearch(html: string, baseUrl: string = "http://localhost:8080", publicBaseUrl: string = "https://www.reddit.com"): CommentSearchItem[] {
  const $ = cheerio.load(html);
  const results: CommentSearchItem[] = [];

  $('.comment.user-comment').each((_i: number, el: any) => {
    const $el = $(el);
    const $link = $el.find('.comment_link').first();
    const href = ($link.attr('href') || '').trim();
    const author = $el.find('.comment_author').first().text().trim();

    // Body: redlib renders <p class="comment_body">{{ body|safe }}</p> and the
    // body HTML usually starts with <div class="md">. HTML parsing closes the
    // <p> before that <div>, so the markdown wrapper normally lands as a
    // sibling of .comment_body. Prefer a markdown container inside the body,
    // then the comment's own markdown wrapper, then the body container itself.
    const $body = $el.find('.comment_body').first();
    let $scope = $body.find('.md').first();
    if (!$scope.length) $scope = $el.find('.md').first();
    if (!$scope.length) $scope = $body;
    const text = $scope.text().trim();

    // A .comment.user-comment element that carries no author, link or body is
    // page chrome, not a result.
    if (!author && !href && !text) return;

    const { score, score_hidden } = parseScore($, $el, '.comment_score');
    const linkTitle = ($link.attr('title') || '').trim() || $link.text().trim();
    const permalink = href ? absolutePublicUrl(href, publicBaseUrl) : undefined;
    const parent_permalink = deriveParentPermalink(permalink);
    const media = extractMedia($, $scope, baseUrl);

    const $created = $el.find('.created').first();
    const created_utc = $created.attr('title')?.trim() || undefined;
    const created_relative = $created.text().trim() || undefined;
    const subreddit = normalizeSubredditLabel($el.find('.comment_subreddit').first().text());

    results.push({
      text,
      author,
      score,
      ...(score_hidden ? { score_hidden } : {}),
      ...(linkTitle ? { linkTitle } : {}),
      ...(permalink ? { permalink } : {}),
      ...(parent_permalink ? { parent_permalink } : {}),
      ...(subreddit ? { subreddit } : {}),
      ...(created_utc ? { created_utc } : {}),
      ...(created_relative ? { created_relative } : {}),
      ...(media.length > 0 ? { media } : {}),
    });
  });

  return results;
}

export interface UserSearchResult {
  username: string;
  description?: string;
}

/**
 * Username carried by an href that resolves to the user route `/u/NAME` or
 * `/user/NAME` on the configured public origin, else undefined. Subreddit cards
 * (`/r/NAME`), the More-results anchor (`?q=…`), bare `/user/` hrefs and
 * profile-post paths (`/user/NAME/comments/…`) are not user routes.
 *
 * Origin comparison includes scheme, host and port: relative hrefs resolve
 * onto the configured public base, while absolute or protocol-relative
 * profile-shaped links on any other origin or scheme are foreign destinations,
 * not Reddit users. The name segment accepts ASCII letters, digits, underscore
 * and hyphen, covering the pinned fixtures (`TestBot42`, `test_dev`,
 * `Alice_99`, `Bob-42`); percent-encoded or otherwise non-name segments are
 * rejected. No length bound is invented — the repository's evidence does not
 * establish one, and a guess could reject a historic account. Pure URL
 * resolution: no request is made and the name is returned verbatim, with its
 * case preserved.
 */
const USERNAME_SEGMENT = /^[A-Za-z0-9_-]+$/;

function userNameFromHref(href: string, publicBaseUrl: string): string | undefined {
  const value = href.trim();
  if (!value) return undefined;
  let base: URL;
  let parsed: URL;
  try {
    base = new URL(publicBaseUrl);
    parsed = new URL(value, base);
  } catch {
    return undefined;
  }
  if (parsed.origin !== base.origin) return undefined;
  const match = parsed.pathname.match(/^\/(?:u|user)\/([^/]+)\/?$/);
  if (!match || !USERNAME_SEGMENT.test(match[1])) return undefined;
  return match[1];
}

/**
 * Parses Redlib user search results HTML into structured JSON.
 *
 * Two result markups are supported and preserved:
 *  - legacy user results: `.comment` divs whose `.comment_link` points at the
 *    user (description from `.comment_body`), and
 *  - current people cards: `a.search_subreddit` cards whose href is the user
 *    route (`u/NAME` display text, no description in the template).
 * Subreddit cards and the More-results anchor fail the user-route check and are
 * not results. Document order is preserved.
 */
export function parseUserSearch(html: string, publicBaseUrl: string = "https://www.reddit.com"): UserSearchResult[] {
  const $ = cheerio.load(html);
  const results: UserSearchResult[] = [];

  $('.comment, a.search_subreddit').each((_i: number, el: any) => {
    const $el = $(el);
    const isCard = $el.is('a');
    const href = isCard
      ? ($el.attr('href') || '')
      : ($el.find('.comment_link').first().attr('href') || '');

    const username = userNameFromHref(href, publicBaseUrl);
    if (!username) return;

    // Legacy comment results carry their description in .comment_body; the
    // current card template supplies none, so none is invented for a card.
    const description = isCard
      ? undefined
      : ($el.find('.comment_body').first().text().trim() || undefined);

    results.push({
      username,
      ...(description ? { description } : {}),
    });
  });

  return results;
}

export interface SubredditInfo {
  title?: string;
  description?: string;
  subscribers?: string;
  moderators?: string[];
  created?: string;
  rules?: string[];
}

/**
 * Parses Redlib subreddit sidebar/about HTML into structured JSON.
 * Extracts title (from <title>), description, and rules from the wiki content.
 */
export function parseSubredditInfo(html: string): SubredditInfo {
  const $ = cheerio.load(html);

  // Title: extract from <title> tag, stripping "Sidebar - " prefix
  const titleRaw = $('title').first().text().trim();
  const title = titleRaw.replace(/^Sidebar\s*-\s*/i, '').trim() || undefined;

  // Description: find the first substantive <p> inside #wiki .md after the intro
  const $md = $('#wiki .md').first();
  let description: string | undefined;

  // Find the <h3> that's not the code-of-conduct intro and not "Rules"
  $md.children('h3').each((_i: number, el: any) => {
    if (description) return false; // stop once we have one
    const h3Text = $(el).text().trim();
    if (h3Text.toLowerCase() === 'rules' || h3Text.toLowerCase().includes('code of conduct')) return;
    // Get the next <p> sibling
    const $nextP = $(el).nextAll('p').first();
    if ($nextP.length) {
      description = $nextP.text().trim();
    }
  });

  // Rules: <h1> elements between <h3>Rules</h3> and the next <hr/> or <h3>
  const rules: string[] = [];
  const $rulesHeader = $md.children('h3').filter((_i: number, el: any) => {
    return $(el).text().trim().toLowerCase() === 'rules';
  }).first();

  if ($rulesHeader.length) {
    // Collect <h1> siblings after Rules until we hit <hr/> or another <h3>
    let $next = $rulesHeader.next();
    while ($next.length) {
      if ($next.is('hr') || $next.is('h3')) break;
      if ($next.is('h1')) {
        const ruleText = $next.text().trim();
        if (ruleText) rules.push(ruleText);
      }
      $next = $next.next();
    }
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(rules.length > 0 ? { rules } : {}),
  };
}

export interface SubredditMeta {
  icon_url?: string;
  display_title?: string;
  name?: string;
  description_short?: string;
  subscribers?: string;
  subscribers_exact?: string;
  active_users?: string;
  active_users_exact?: string;
}

/**
 * Parses the #subreddit panel from a subreddit main page (e.g. /r/rust/hot).
 * Extracts icon, title, name, short description, and member/active stats.
 */
export function parseSubredditMeta(html: string, baseUrl: string = "http://localhost:8080"): SubredditMeta {
  const $ = cheerio.load(html);

  const iconSrc = $('#sub_icon').attr('src') || undefined;
  // Make icon_url absolute against the instance base URL (it proxies the bytes)
  const icon_url = iconSrc ? absoluteUrl(iconSrc, baseUrl) : undefined;
  const display_title = $('#sub_title').first().text().trim() || undefined;
  const name = $('#sub_name').first().text().trim() || undefined;
  const description_short = $('#sub_description').first().text().trim() || undefined;

  // #sub_details contains paired <label> and <div> children:
  //   <label>Members</label><label>Active</label><div title="415519">415.5k</div><div title="0">0</div>
  const $details = $('#sub_details');
  const labels = $details.children('label');
  const divs = $details.children('div');

  let subscribers: string | undefined;
  let subscribers_exact: string | undefined;
  let active_users: string | undefined;
  let active_users_exact: string | undefined;

  labels.each((i: number, el: any) => {
    const label = $(el).text().trim().toLowerCase();
    const $div = divs.eq(i);
    const text = $div.text().trim();
    const exact = $div.attr('title') || undefined;
    if (label === 'members') {
      subscribers = text || undefined;
      subscribers_exact = exact;
    } else if (label === 'active') {
      active_users = text || undefined;
      active_users_exact = exact;
    }
  });

  return {
    ...(icon_url ? { icon_url } : {}),
    ...(display_title ? { display_title } : {}),
    ...(name ? { name } : {}),
    ...(description_short ? { description_short } : {}),
    ...(subscribers ? { subscribers } : {}),
    ...(subscribers_exact ? { subscribers_exact } : {}),
    ...(active_users ? { active_users } : {}),
    ...(active_users_exact ? { active_users_exact } : {}),
  };
}

export interface UserComment {
  text: string;
  score: number | null;
  linkTitle?: string;
  linkHref?: string;
  subreddit?: string;
  created_utc?: string;
  created_relative?: string;
  media?: MediaItem[];
}

export interface UserProfile {
  username: string;
  karma?: string;
  cake_day?: string;
  description?: string;
  posts: PostListItem[];
  comments: UserComment[];
}

/**
 * Parses Redlib user profile HTML into structured JSON.
 * Handles all user listing pages: overview, submitted, comments.
 */
export function parseUserProfile(html: string, baseUrl: string = "http://localhost:8080", publicBaseUrl: string = "https://www.reddit.com"): UserProfile {
  const $ = cheerio.load(html);

  // Extract profile info from sidebar
  const username = $('#user_title').first().text().trim();
  const description = $('#user_description').first().text().trim() || undefined;

  // Extract karma and cake_day from #user_details
  // Structure: <label>Karma</label><label>Created</label><div>VALUE1</div><div>VALUE2</div>
  const detailsLabels = $('#user_details label');
  const detailsDivs = $('#user_details div');
  let karma: string | undefined;
  let cake_day: string | undefined;

  detailsLabels.each((i: number, el: any) => {
    const label = $(el).text().trim().toLowerCase();
    const value = detailsDivs.eq(i).text().trim();
    if (label === 'karma') {
      karma = value || undefined;
    } else if (label === 'created') {
      cake_day = value || undefined;
    }
  });

  // Parse posts (reuse the shared post-element parser with flair extraction)
  const posts: PostListItem[] = [];
  $('#posts > .post').each((_i: number, el: any) => {
    const post = parsePostElement($, $(el), baseUrl, publicBaseUrl);
    if (post) posts.push(post);
  });

  // Parse comments (user-comment elements)
  const comments: UserComment[] = [];
  $('#posts > .comment.user-comment').each((_i: number, el: any) => {
    const $el = $(el);
    const $link = $el.find('.comment_link').first();
    const linkTitle = $link.attr('title') || $link.text().trim();
    const linkHref = $link.attr('href') || undefined;

    const bodyText = $el.find('.md').first().text().trim();
    const { score } = parseScore($, $el, '.comment_score');
    // Optional media from the comment body, using the shared extractor. The
    // markdown body is preferred; the comment body container is the fallback
    // when a comment has no rendered markdown wrapper. Legacy fixtures wrap the
    // markdown div in a <p class="comment_body">, which HTML parsing splits into
    // siblings, so an unwrapped .md inside the comment is equally valid.
    const $nestedMd = $el.find('.comment_body .md').first();
    const $mdBody = $nestedMd.length ? $nestedMd : $el.find('.md').first();
    const $commentBodyScope = $mdBody.length
      ? $mdBody
      : $el.find('.comment_body').first();
    const media = extractMedia($, $commentBodyScope, baseUrl);

    const subreddit = normalizeSubredditLabel($el.find('.comment_subreddit').first().text());

    // Extract created timestamps from <span class="created"> or <a class="created">
    const $created = $el.find('.created').first();
    const created_utc = $created.attr('title')?.trim() || undefined;
    const created_relative = $created.text().trim() || undefined;

    comments.push({
      text: bodyText,
      score,
      ...(linkTitle ? { linkTitle } : {}),
      // linkHref is a post link — make it absolute against the public base
      // URL, matching the post permalinks in the same output.
      ...(linkHref ? { linkHref: absolutePublicUrl(linkHref, publicBaseUrl) } : {}),
      ...(subreddit ? { subreddit } : {}),
      ...(created_utc ? { created_utc } : {}),
      ...(created_relative ? { created_relative } : {}),
      ...(media.length > 0 ? { media } : {}),
    });
  });

  return {
    username,
    ...(karma ? { karma } : {}),
    ...(cake_day ? { cake_day } : {}),
    ...(description ? { description } : {}),
    posts,
    comments,
  };
}

export interface WikiPage {
  title: string;
  content: string;
}

/**
 * Block-level tags that start and end a text line when extracting wiki bodies.
 * This is deliberate word separation for a plain-text field, not markdown
 * rendering: inline elements stay on their surrounding line.
 */
const WIKI_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Text of a wiki body element with block boundaries turned into newlines and
 * runs of horizontal whitespace collapsed. Body words and their order are
 * preserved; blank lines are dropped rather than rendered.
 */
function blockSeparatedText($root: cheerio.Cheerio<any>): string {
  let text = '';
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const walk = (node: any) => {
    if (node.type === 'text') {
      text += node.data || '';
      return;
    }
    if (node.type !== 'tag') return;
    const name = String(node.name || '').toLowerCase();
    if (name === 'br') {
      newline();
      return;
    }
    const block = WIKI_BLOCK_TAGS.has(name);
    if (block) newline();
    for (const child of node.children || []) walk(child);
    if (block) newline();
  };
  const root = $root.get(0);
  for (const child of root?.children || []) walk(child);
  return text
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Parses Redlib wiki page HTML into structured JSON.
 * Extracts title from <title> tag and content from #wiki .md.
 */
export function parseWikiPage(html: string): WikiPage {
  const $ = cheerio.load(html);

  // Title: extract from <title> tag, format: "page_name - subreddit"
  const titleRaw = $('title').first().text().trim();
  // Split on " - " to get the page name (before the dash)
  const dashIndex = titleRaw.lastIndexOf(' - ');
  const title = dashIndex > 0 ? titleRaw.substring(0, dashIndex).trim() : titleRaw;

  // Content: extract text from #wiki .md (.wiki or .md.wiki). The generated
  // table of contents is navigation that duplicates every body heading, so it
  // is removed before extraction.
  const $wikiMd = $('#wiki .md').first();
  const $wikiBody = $wikiMd.clone();
  $wikiBody.find('.toc').remove();
  const content = blockSeparatedText($wikiBody);

  return { title, content };
}

export function parsePostDetails(html: string, limit: number = 10, baseUrl: string = "http://localhost:8080", publicBaseUrl: string = "https://www.reddit.com"): PostDetails {
  const $ = cheerio.load(html);
  const $postTitle = $('.post_title').first();
  
  // Extract flair if present
  const $flair = $postTitle.find('a.post_flair').first();
  let flair: FlairData | undefined;
  if ($flair.length) {
    flair = extractFlairFromAnchor($, $flair, publicBaseUrl, baseUrl);
  }

  // Derive the post path (for public comment permalinks) from the first
  // non-flair title link; fall back to the first comment's created href, then
  // to the footer #post_links permalink anchor (present even with no comments).
  const $postTitleLink = $postTitle.find('a').not('.post_flair').first();
  let postPath = $postTitleLink.attr('href') || '';
  if (!postPath) {
    const firstCreatedHref = $('.comment_data a.created').first().attr('href') || '';
    // Strip query/fragment first, then trailing slashes, then drop the final
    // path segment (the comment id) — robust whether or not the href ends in '/'.
    postPath = firstCreatedHref
      .split('#')[0]
      .split('?')[0]
      .replace(/\/+$/, '')
      .replace(/\/[^/]+$/, '/');
  }
  if (!postPath) {
    // No comment anchors on the page: use the post's own footer permalink
    // link (#post_links), which redlib renders on every detail page.
    postPath = ($('#post_links a[href]').first().attr('href') || '')
      .split('#')[0]
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  // Post-level id and permalink, following the same extraction rules as
  // parsePostElement: prefer the post div's id attribute, else match the post
  // id from the first non-flair title href, else from the derived post path.
  // The permalink uses the first non-flair title href when present (absolute
  // hrefs pass through verbatim, empty hrefs are omitted), else the derived
  // post path prefixed with the public base URL.
  let id = $('.post').first().attr('id') || '';
  if (!id) {
    const idMatch = ($postTitleLink.attr('href') || '').match(/\/comments\/([a-z0-9]+)/i);
    id = idMatch ? idMatch[1] : '';
  }
  if (!id && postPath) {
    const pathMatch = postPath.match(/\/comments\/([a-z0-9]+)/i);
    id = pathMatch ? pathMatch[1] : '';
  }

  const titleHref = ($postTitleLink.attr('href') || '').trim();
  let permalink: string | undefined;
  if (titleHref) {
    permalink = absolutePublicUrl(titleHref, publicBaseUrl);
  } else if (postPath) {
    permalink = absolutePublicUrl(postPath, publicBaseUrl);
  }

  // Title text excludes the flair anchor and the identified NSFW/Spoiler
  // metadata nodes; actual title words are preserved. The same metadata nodes
  // drive the flags, so title words alone never set them.
  const titleFlags = analyzeTitleFlags($, $postTitle);
  const title = titleTextExcluding($, $postTitle, titleFlags.metadataNodes);
  const author = $('.post_author').first().text().trim();
  const subreddit = normalizeSubredditLabel($('.post_subreddit').first().text());
  const body = $('.post_body').first().text().trim();
  const { score, score_hidden, score_exact } = parseScore($, $('.post').first());

  // Extract created timestamps from .post_header span.created
  const $created = $('.post_header span.created').first();
  const created_utc = $created.attr('title')?.trim() || undefined;
  const created_relative = $created.text().trim() || undefined;

  const nsfw = titleFlags.nsfw;
  const spoiler = titleFlags.spoiler;

  // Determine post type from the whole page
  const $postDiv = $('.post').first();
  const post_type = determinePostType($postDiv, publicBaseUrl, permalink);

  // Author flair
  const $postAuthor = $('.post_author').first();
  let author_flair: 'moderator' | 'admin' | undefined;
  if ($postAuthor.hasClass('moderator')) author_flair = 'moderator';
  else if ($postAuthor.hasClass('admin')) author_flair = 'admin';

  // Post-level media: image/gif/video URLs from the post's content region.
  // Header (awards/author badges), title (flair/tag markup), footer
  // (permalink/download/reddit popup) and thumbnail images are decoration and
  // navigation, not content, so they are excluded before extraction; body and
  // media-container assets (including bare body images) are retained.
  const $mediaScope = $postDiv.clone();
  $mediaScope.find('.post_header, .post_title, .post_footer, .post_thumbnail').remove();
  const postMedia = extractMedia($, $mediaScope, baseUrl);

  // Link destination (link posts only): the detail template renders it in
  // #post_url[href]. Reddit-relative targets resolve against the public base,
  // scheme-bearing and protocol-relative targets are returned verbatim, and
  // when the anchor or its href is absent the field is absent — the post
  // permalink is never substituted.
  const postUrlHref = ($postDiv.find('#post_url').first().attr('href') || '').trim();
  const external_url = postUrlHref ? resolveDestinationUrl(postUrlHref, publicBaseUrl) : undefined;

  // Recursive comment parsing
  function parseComment($comment: cheerio.Cheerio<any>, depth: number): CommentData {
    const id = $comment.attr('id') || '';
    const $author = $comment.find('.comment_author').first();
    const author = $author.text().trim();
    const author_is_op = $author.hasClass('op');
    const $commentBody = $comment.find('.comment_body .md').first();
    const text = $commentBody.text().trim();
    const media = extractMedia($, $commentBody, baseUrl);
    const { score, score_hidden } = parseScore($, $comment, '.comment_score');

    // Created timestamp and permalink from a.created
    const $created = $comment.find('.comment_data a.created').first();
    const created_utc = $created.attr('title')?.trim() || undefined;
    const created_relative = $created.text().trim() || undefined;
    const permalinkHref = $created.attr('href') || undefined;
    // Public permalink: full reddit.com URL + fragment (was a bare '#fragment' before)
    let permalink: string | undefined;
    if (permalinkHref) {
      const fragment = permalinkHref.includes('#') ? permalinkHref.split('#').pop() : '';
      permalink = postPath
        ? `${absolutePublicUrl(postPath, publicBaseUrl)}${fragment ? `#${fragment}` : ''}`
        : permalinkHref;
    }

    // Recurse into replies — only direct children of this comment's blockquote.replies
    const replies: CommentData[] = [];
    $comment.children('details').children('blockquote.replies').children('.comment').each((_i: number, el: any) => {
      replies.push(parseComment($(el), depth + 1));
    });

    return {
      id,
      author,
      text,
      score,
      ...(score_hidden ? { score_hidden } : {}),
      author_is_op,
      ...(created_utc ? { created_utc } : {}),
      ...(created_relative ? { created_relative } : {}),
      ...(permalink ? { permalink } : {}),
      ...(media.length > 0 ? { media } : {}),
      depth,
      ...(replies.length > 0 ? { replies } : {}),
    };
  }

  // Count all comments (recursive) for commentCount
  const commentCount = $('.comment').length;

  // Parse top-level comments (those NOT inside a blockquote.replies)
  const allTopLevel: CommentData[] = [];
  $('.comment').each((_i: number, el: any) => {
    const $el = $(el);
    // Skip comments that are nested inside another comment's replies
    if ($el.parents('blockquote.replies').length > 0) return;
    allTopLevel.push(parseComment($el, 0));
  });

  // Apply limit at top level
  const comments = allTopLevel.slice(0, limit);

  return {
    title,
    ...(id ? { id } : {}),
    author,
    subreddit,
    score,
    body,
    commentCount,
    comments,
    ...(permalink ? { permalink } : {}),
    ...(flair ? { flair } : {}),
    ...(created_utc ? { created_utc } : {}),
    ...(created_relative ? { created_relative } : {}),
    ...(score_exact !== undefined ? { score_exact } : {}),
    ...(score_hidden ? { score_hidden } : {}),
    ...(postMedia.length > 0 ? { media: postMedia } : {}),
    ...(nsfw ? { nsfw } : {}),
    ...(spoiler ? { spoiler } : {}),
    ...(post_type ? { post_type } : {}),
    ...(external_url ? { external_url } : {}),
    ...(author_flair ? { author_flair } : {}),
  };
}
