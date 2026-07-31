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
  title: string;
  author: string;
  subreddit: string;
  score: number | null;
  body: string;
  commentCount: number;
  comments: CommentData[];
  flair?: FlairData;
  created_utc?: string;
  created_relative?: string;
  score_exact?: number;
  score_hidden?: boolean;
  media?: MediaItem[];
  nsfw?: boolean;
  spoiler?: boolean;
  post_type?: 'self' | 'link' | 'image' | 'video' | 'gallery';
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
  const text_color = styleAttr.match(/color:\s*([^;]+)/)?.[1]?.trim();
  const bg_color = styleAttr.match(/background:\s*([^;]+)/)?.[1]?.trim();
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
 * Detects the post type based on DOM elements on the post element.
 */
function determinePostType($el: cheerio.Cheerio<any>): 'self' | 'link' | 'image' | 'video' | 'gallery' | undefined {
  // Check for gallery (thumbnail span contains "gallery" text)
  const $thumbnailSpan = $el.find('.post_thumbnail span').first();
  if ($thumbnailSpan.length && $thumbnailSpan.text().trim().toLowerCase() === 'gallery') {
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

  // Check for link (external thumbnail href)
  const $thumbnail = $el.find('a.post_thumbnail').first();
  if ($thumbnail.length) {
    const href = $thumbnail.attr('href') || '';
    // If href is a self-post path (contains /comments/), it's a self post
    if (href.includes('/comments/')) {
      return 'self';
    }
    // Otherwise it's an external link
    return 'link';
  }

  // Check for self post (has post_body.post_preview or no media)
  if ($el.find('.post_body.post_preview').length > 0) {
    return 'self';
  }

  return undefined;
}

/**
 * Checks if the post title contains NSFW or Spoiler text.
 * Redlib renders these as text nodes after the title link.
 */
function checkPostTitleTag($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): { nsfw: boolean; spoiler: boolean } {
  // Get the full text content of .post_title, which includes NSFW/Spoiler text nodes
  const fullTitleText = $el.find('.post_title').text().trim();
  return {
    nsfw: /\bNSFW\b/.test(fullTitleText),
    spoiler: /\bSpoiler\b/i.test(fullTitleText),
  };
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
    const url = imgSrc || href || '';
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
  $scope.find('video source[src]').each((_i, el) => {
    const src = $(el).attr('src') || '';
    if (src) push('video', src);
  });
  $scope.find('video[src]').each((_i, el) => {
    const src = $(el).attr('src') || '';
    if (src) push('video', src);
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

  const subreddit = $el.find('.post_subreddit').text().replace('r/', '').replace('u/', '').trim();
  const author = $el.find('.post_author').text().trim();
  const { score, score_hidden, score_exact } = parseScore($, $el);
  const commentsText = $el.find('.post_comments').first().text().trim();
  const commentCountMatch = commentsText.match(/(\d+)/);
  const commentCount = commentCountMatch ? parseInt(commentCountMatch[1]) : 0;

  // Extract created timestamps from <span class="created">
  const $created = $el.find('.post_header span.created').first();
  const created_utc = $created.attr('title')?.trim() || undefined;
  const created_relative = $created.text().trim() || undefined;

  // Extract new metadata fields
  const stickied = $el.hasClass('stickied');
  const { nsfw, spoiler } = checkPostTitleTag($, $el);
  const post_type = determinePostType($el);
  const author_flair = extractAuthorFlair($el);

  // Extract thumbnail URL from post_thumbnail (svg image href or img src)
  const $thumbnail = $el.find('a.post_thumbnail').first();
  let thumbnail_url: string | undefined;
  let external_url: string | undefined;
  if ($thumbnail.length) {
    const thumbHref = $thumbnail.attr('href') || '';
    // external_url: only when href is an external link (starts with http)
    if (isAbsoluteUrl(thumbHref)) {
      external_url = thumbHref;
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
    ...(href.trim() ? { permalink: absolutePublicUrl(href, publicBaseUrl) } : {}),
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

export interface UserSearchResult {
  username: string;
  description?: string;
}

/**
 * Parses Redlib user search results HTML into structured JSON.
 * User results appear as .comment divs (posts with empty titles).
 */
export function parseUserSearch(html: string): UserSearchResult[] {
  const $ = cheerio.load(html);
  const results: UserSearchResult[] = [];

  $('.comment').each((_i: number, el: any) => {
    const $el = $(el);
    const $link = $el.find('.comment_link').first();
    const href = $link.attr('href') || '';

    // Extract username from href like /user/USERNAME or /u/USERNAME
    const userMatch = href.match(/\/u(?:ser)?\/([^/?]+)/i);
    const username = userMatch ? userMatch[1] : '';

    if (!username) return;

    const description = $el.find('.comment_body').first().text().trim() || undefined;

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

    const subreddit = $el.find('.comment_subreddit').first().text().replace('r/', '').trim();

    // Extract created timestamps from <span class="created"> or <a class="created">
    const $created = $el.find('.created').first();
    const created_utc = $created.attr('title')?.trim() || undefined;
    const created_relative = $created.text().trim() || undefined;

    comments.push({
      text: bodyText.substring(0, 2000),
      score,
      ...(linkTitle ? { linkTitle } : {}),
      // linkHref is a post link — make it absolute against the public base
      // URL, matching the post permalinks in the same output.
      ...(linkHref ? { linkHref: absolutePublicUrl(linkHref, publicBaseUrl) } : {}),
      ...(subreddit ? { subreddit } : {}),
      ...(created_utc ? { created_utc } : {}),
      ...(created_relative ? { created_relative } : {}),
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

  // Content: extract text from #wiki .md (.wiki or .md.wiki)
  const $wikiMd = $('#wiki .md').first();
  const content = $wikiMd.text().trim();

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
  // non-flair title link; fall back to the first comment's created href.
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

  // Get title text, excluding any flair link text  
  const title = $postTitle.clone().find('a.post_flair').remove().end().text().trim();
  const author = $('.post_author').first().text().trim();
  const subreddit = $('.post_subreddit').first().text().replace('r/', '').trim();
  const body = $('.post_body').first().text().trim();
  const { score, score_hidden, score_exact } = parseScore($, $('.post').first());

  // Extract created timestamps from .post_header span.created
  const $created = $('.post_header span.created').first();
  const created_utc = $created.attr('title')?.trim() || undefined;
  const created_relative = $created.text().trim() || undefined;

  // Check NSFW/Spoiler in post title full text
  const fullTitleText = $postTitle.text().trim();
  const nsfw = /\bNSFW\b/.test(fullTitleText);
  const spoiler = /\bSpoiler\b/i.test(fullTitleText);

  // Determine post type from the whole page
  const $postDiv = $('.post').first();
  const post_type = determinePostType($postDiv);

  // Author flair
  const $postAuthor = $('.post_author').first();
  let author_flair: 'moderator' | 'admin' | undefined;
  if ($postAuthor.hasClass('moderator')) author_flair = 'moderator';
  else if ($postAuthor.hasClass('admin')) author_flair = 'admin';

  // Post-level media: image/gif/video URLs from the post's media content region
  const postMedia = extractMedia($, $postDiv, baseUrl);

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
    author,
    subreddit,
    score,
    body: body.substring(0, 2000),
    commentCount,
    comments,
    ...(flair ? { flair } : {}),
    ...(created_utc ? { created_utc } : {}),
    ...(created_relative ? { created_relative } : {}),
    ...(score_exact !== undefined ? { score_exact } : {}),
    ...(score_hidden ? { score_hidden } : {}),
    ...(postMedia.length > 0 ? { media: postMedia } : {}),
    ...(nsfw ? { nsfw } : {}),
    ...(spoiler ? { spoiler } : {}),
    ...(post_type ? { post_type } : {}),
    ...(author_flair ? { author_flair } : {}),
  };
}
