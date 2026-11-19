import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { parsePostList, parsePostDetails, parseSubredditSearch, parseUserSearch, parseCommentSearch, parseSubredditInfo, parseSubredditMeta, parseUserProfile, parseWikiPage, CommentData } from '../src/parsers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('parsePostList', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('post-list.html');
  });

  it('should return an array of posts', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from the id attribute', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    // The first post in announcements/hot has ID "t93ec3"
    expect(posts[0].id).toBe('t93ec3');
  });

  it('should parse post titles', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
    expect(posts[0].title).toContain('closed for new posts');
  });

  it('should parse subreddit names', () => {
    const posts = parsePostList(html);
    expect(posts[0].subreddit).toBe('announcements');
  });

  it('should parse author names', () => {
    const posts = parsePostList(html);
    // The first post author is kethryvis (the "u/" prefix is stripped)
    expect(posts[0].author).toBeTruthy();
  });

  it('should parse score as a number', () => {
    const posts = parsePostList(html);
    expect(typeof posts[0].score).toBe('number');
  });

  it('should parse comment count as a number', () => {
    const posts = parsePostList(html);
    // The first post has exactly one comment (title="1 comment")
    expect(posts[0].commentCount).toBe(1);
  });

  it('should generate a permalink for each post', () => {
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBeTruthy();
    expect(posts[0].permalink).toContain('/comments/');
  });

  it('should handle multiple posts', () => {
    const posts = parsePostList(html);
    expect(posts.length).toBeGreaterThan(1);
  });

  it('should extract created_utc and created_relative timestamps', () => {
    const posts = parsePostList(html);
    expect(posts[0].created_utc).toBe('Mar 08 2022, 00:02:48 UTC');
    expect(posts[0].created_relative).toBe("Mar 08 '22");
    // Verify all posts have timestamps
    for (const post of posts) {
      expect(post.created_utc).toBeTruthy();
      expect(typeof post.created_utc).toBe('string');
      expect(post.created_relative).toBeTruthy();
      expect(typeof post.created_relative).toBe('string');
      expect(post.created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
    }
  });
});

describe('parsePostList with sorted posts', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('sorted-posts.html');
  });

  it('should parse sorted posts as an array', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse titles from sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should parse subreddit names from sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].subreddit).toBeTruthy();
  });

  it('should parse authors from sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].author).toBeTruthy();
  });

  it('should parse score as a number from sorted posts', () => {
    const posts = parsePostList(html);
    expect(typeof posts[0].score).toBe('number');
  });

  it('should parse comment count as a number from sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].commentCount).toBe(90);
  });

  it('should generate permalinks for sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBeTruthy();
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink?.includes('/comments/'));
    expect(postsWithPermalinks.length).toBeGreaterThan(0);
    expect(postsWithPermalinks[0].permalink).toContain('/comments/');
  });

  it('should extract flair with text, colors, and filter_url from flaired posts', () => {
    const posts = parsePostList(html);
    // Find at least one flaired post (there are many in sorted-posts.html)
    const flaired = posts.filter(p => p.flair);
    expect(flaired.length).toBeGreaterThan(0);

    const firstFlair = flaired[0].flair!;
    expect(firstFlair.text).toBeTruthy();
    expect(firstFlair.filter_url).toBeTruthy();
    expect(firstFlair.filter_url).toContain('search?q=flair_name');
    expect(Array.isArray(firstFlair.emoji_urls)).toBe(true);
    // sorted-posts.html flairs have text-only spans (emoji_urls should be empty array)
  });

  it('should extract text_color and bg_color from flair style attribute', () => {
    const posts = parsePostList(html);
    const flaired = posts.filter(p => p.flair);
    expect(flaired.length).toBeGreaterThan(0);

    // Find a flair with background color (most have them in sorted-posts.html)
    const withBg = flaired.find(p => p.flair!.bg_color);
    expect(withBg).toBeDefined();
    if (withBg) {
      expect(withBg.flair!.bg_color).toMatch(/^#[a-fA-F0-9]+$/);
    }
  });

  it('should read the flair text color past a leading background-color in list posts', () => {
    const listHtml = `<html><body><div class="post" id="flair1">
      <p class="post_header">
        <a class="post_subreddit" href="/r/sub">r/sub</a>
        <a class="post_author" href="/u/user">u/user</a>
      </p>
      <h2 class="post_title">
        <a href="/r/sub/search?q=flair_name%3A%22Bg%22&restrict_sr=on" class="post_flair"
           style="background-color:#123456; color:#ffffff;"><span>Bg</span></a>
        <a href="/r/sub/comments/flair1/title/">Title</a>
      </h2>
      <span class="post_score" title="3">3</span>
      <div class="post_footer"><a href="/r/sub/comments/flair1/title/" class="post_comments" title="2 comments">2 comments</a></div>
    </div></body></html>`;
    const posts = parsePostList(listHtml);
    expect(posts).toHaveLength(1);
    expect(posts[0].flair!.text_color).toBe('#ffffff');
    expect(posts[0].flair!.bg_color).toBeUndefined();
  });

  it('should parse specific known flair text from sorted-posts', () => {
    const posts = parsePostList(html);
    // Look for known flairs from the fixture
    const discussionPosts = posts.filter(p => p.flair?.text === '🎙️ discussion');
    const newsPosts = posts.filter(p => p.flair?.text === '🗞️ news');
    expect(discussionPosts.length).toBeGreaterThan(0);
    expect(newsPosts.length).toBeGreaterThan(0);
  });

  it('should extract created_utc and created_relative from sorted posts', () => {
    const posts = parsePostList(html);
    // sorted-posts.html has relative timestamps like "1d ago", "8h ago", "10h ago"
    expect(posts[0].created_utc).toBeTruthy();
    expect(posts[0].created_relative).toBeTruthy();
    // Find posts with specific relative timestamps
    const oneDayAgo = posts.filter(p => p.created_relative === '1d ago');
    const hoursAgo = posts.filter(p => p.created_relative?.includes('h ago'));
    expect(oneDayAgo.length).toBeGreaterThan(0);
    expect(hoursAgo.length).toBeGreaterThan(0);
    // UTC format should match the expected pattern
    expect(posts[0].created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
  });

  it('should extract score_exact from post_score title attribute', () => {
    const posts = parsePostList(html);
    // First post has score 399, second has 306 per fixture
    expect(posts[0].score_exact).toBe(399);
    expect(typeof posts[0].score_exact).toBe('number');
    expect(posts[1].score_exact).toBe(306);
    // Verify all posts have a numeric score_exact
    for (const post of posts) {
      if (post.score_exact !== undefined) {
        expect(typeof post.score_exact).toBe('number');
      }
    }
  });

  it('should detect self post_type when post has post_body.post_preview', () => {
    const posts = parsePostList(html);
    // First post (id 1v7h4bb) is a self/text post with .post_body.post_preview
    const selfPost = posts.find(p => p.id === '1v7h4bb');
    expect(selfPost).toBeDefined();
    expect(selfPost!.post_type).toBe('self');
  });

  it('should detect link post_type when post has external thumbnail', () => {
    const posts = parsePostList(html);
    // Second post (id 1v2plbn) is a link post with external href
    const linkPost = posts.find(p => p.id === '1v2plbn');
    expect(linkPost).toBeDefined();
    expect(linkPost!.post_type).toBe('link');
  });
});

describe('parsePostList with frontpage-popular (thumbnails + external URLs)', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('frontpage-popular.html');
  });

  it('should extract thumbnail_url from svg image href on link posts', () => {
    const posts = parsePostList(html);
    // The yahoo.com link post has an svg image thumbnail
    const linkPosts = posts.filter(p => p.thumbnail_url);
    expect(linkPosts.length).toBeGreaterThan(0);
    // Verify thumbnail_url contains a preview path
    const withPreview = linkPosts.find(p => p.thumbnail_url!.includes('/preview/'));
    expect(withPreview).toBeDefined();
  });

  it('should extract external_url on link posts with external thumbnail href', () => {
    const posts = parsePostList(html);
    // The yahoo.com post should have external_url starting with https://
    const externalPosts = posts.filter(p => p.external_url);
    expect(externalPosts.length).toBeGreaterThan(0);
    for (const p of externalPosts) {
      expect(p.external_url).toMatch(/^https?:\/\//);
    }
  });

  it('should not set external_url on self-post thumbnails (internal href)', () => {
    const posts = parsePostList(html);
    // The mildlyinfuriating gallery post has an internal thumbnail href
    const selfThumb = posts.find(p => p.id === '1v81pht');
    expect(selfThumb).toBeDefined();
    expect(selfThumb!.external_url).toBeUndefined();
    // But it should still have a thumbnail_url
    expect(selfThumb!.thumbnail_url).toBeTruthy();
  });

  it('should have both thumbnail_url and external_url on external link posts', () => {
    const posts = parsePostList(html);
    // Find a post with both fields
    const bothFields = posts.find(p => p.thumbnail_url && p.external_url);
    expect(bothFields).toBeDefined();
    expect(bothFields!.external_url).toMatch(/^https?:\/\//);
    expect(bothFields!.thumbnail_url).toContain('/preview/');
  });

  it('should not set thumbnail_url on no_thumbnail posts', () => {
    const posts = parsePostList(html);
    // The theguardian.com post has class "no_thumbnail" and only an SVG placeholder (no image/img)
    const noThumb = posts.find(p => p.external_url?.includes('theguardian.com'));
    expect(noThumb).toBeDefined();
    expect(noThumb!.thumbnail_url).toBeUndefined();
  });
});

describe('parsePostList with search results', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('search-posts.html');
  });

  it('should parse search results as an array of posts', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse titles from search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should parse subreddit names from search results', () => {
    const posts = parsePostList(html);
    // Each search result should have a subreddit
    expect(posts[0].subreddit).toBeTruthy();
  });

  it('should parse authors from search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].author).toBeTruthy();
  });

  it('should return null score + score_hidden on search results (Reddit hides scores)', () => {
    const posts = parsePostList(html);
    // search-posts.html is a real search page: every post_score has title="Hidden"
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBe(true);
  });

  it('should parse comment count as a number from search results', () => {
    const posts = parsePostList(html);
    // search-posts.html: first post has title="0 comments"
    expect(posts[0].commentCount).toBe(0);
  });

  it('should generate permalinks for search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBeTruthy();
    expect(posts[0].permalink).toContain('/comments/');
  });

  it('should return at least 20 posts from search results', () => {
    const posts = parsePostList(html);
    expect(posts.length).toBeGreaterThanOrEqual(20);
  });

  it('should extract created_utc and created_relative from search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].created_utc).toBeTruthy();
    expect(posts[0].created_relative).toBeTruthy();
    // search-posts.html has relative timestamps like "0m ago", "1m ago"
    expect(posts[0].created_relative).toMatch(/\d+m ago/);
    expect(posts[0].created_utc).toMatch(/Jul 27 2026/);
    // Verify all posts have timestamps
    for (const post of posts) {
      expect(post.created_utc).toBeTruthy();
      expect(post.created_relative).toBeTruthy();
    }
  });
});

// Comment counts: the exact count lives in the `.post_comments` title
// attribute ("3426 comments"); the visible text is rounded ("3.4k comments").
// The exact attribute wins. Supported compact/comma display text is only a
// fallback for markup without an exact title, and missing/unparseable values
// keep the previous first-integer/zero semantics.
describe('comment counts: exact title attribute preferred over display text', () => {
  type ExactRow = { fixture: string; profile?: true; id: string; count: number };

  // Frozen literal oracles for every visible rounded/exact mismatch in the
  // checked-in fixtures (44 posts across the five post-card families).
  const EXACT_ROWS: ExactRow[] = [
    { fixture: 'post-list.html', id: 'nw2hs6', count: 3426 },
    { fixture: 'post-list.html', id: 'mcisdf', count: 35738 },
    { fixture: 'post-list.html', id: 'hrrh23', count: 4034 },
    { fixture: 'post-list.html', id: 'hi3oht', count: 38306 },
    { fixture: 'post-list.html', id: 'gxas21', count: 40640 },
    { fixture: 'post-list.html', id: 'g0s6tn', count: 99478 },
    { fixture: 'post-list.html', id: 'fub7xo', count: 2678 },
    { fixture: 'post-list.html', id: 'ft3e3q', count: 1488 },
    { fixture: 'post-list.html', id: 'fo7p5b', count: 3809 },
    { fixture: 'post-list.html', id: 'f8y9nx', count: 16120 },
    { fixture: 'post-list.html', id: 'dbf9nj', count: 9930 },
    { fixture: 'post-list.html', id: 'ct2gcb', count: 1093 },
    { fixture: 'post-list.html', id: 'chdx1h', count: 1693 },
    { fixture: 'post-list.html', id: 'cevm31', count: 2630 },
    { fixture: 'post-list.html', id: 'bpfyx1', count: 1000 },
    { fixture: 'frontpage-popular.html', id: '1v81pht', count: 15335 },
    { fixture: 'frontpage-popular.html', id: '1v7z1m7', count: 7171 },
    { fixture: 'frontpage-popular.html', id: '1v8a8ds', count: 1411 },
    { fixture: 'frontpage-popular.html', id: '1v8bw52', count: 7010 },
    { fixture: 'frontpage-popular.html', id: '1v85ulg', count: 6674 },
    { fixture: 'frontpage-popular.html', id: '1v8605l', count: 4516 },
    { fixture: 'frontpage-popular.html', id: '1v8080p', count: 3686 },
    { fixture: 'frontpage-popular.html', id: '1v8953r', count: 1706 },
    { fixture: 'frontpage-popular.html', id: '1v803fv', count: 3084 },
    { fixture: 'frontpage-popular.html', id: '1v867jz', count: 2600 },
    { fixture: 'frontpage-popular.html', id: '1v85i50', count: 1842 },
    { fixture: 'frontpage-popular.html', id: '1v7saim', count: 1805 },
    { fixture: 'frontpage-popular.html', id: '1v85vzp', count: 1565 },
    { fixture: 'frontpage-popular.html', id: '1v7xstj', count: 1527 },
    { fixture: 'frontpage-all.html', id: '1v8a8ds', count: 1411 },
    { fixture: 'frontpage-all.html', id: '1v8953r', count: 1706 },
    { fixture: 'frontpage-all.html', id: '1v87arj', count: 1158 },
    { fixture: 'frontpage-all.html', id: '1v8605l', count: 4514 },
    { fixture: 'comment-search.html', id: '1o92zjz', count: 3144 },
    { fixture: 'comment-search.html', id: '1uxfntt', count: 2678 },
    { fixture: 'comment-search.html', id: '1t94d24', count: 1656 },
    { fixture: 'comment-search.html', id: '1rrz8ls', count: 1184 },
    { fixture: 'comment-search.html', id: '1oavld6', count: 1828 },
    { fixture: 'comment-search.html', id: '1mwz3a8', count: 3472 },
    { fixture: 'comment-search.html', id: '1p68yp2', count: 2186 },
    { fixture: 'user-submitted.html', profile: true, id: 'ipiung', count: 1415 },
    { fixture: 'user-submitted.html', profile: true, id: '6auyq9', count: 2078 },
    { fixture: 'user-submitted.html', profile: true, id: '66q4is', count: 3203 },
    { fixture: 'user-submitted.html', profile: true, id: '3cxedn', count: 12527 },
  ];

  it.each(EXACT_ROWS)('$fixture $id → $count comments', ({ fixture, profile, id, count }) => {
    const html = loadFixture(fixture);
    const posts = profile ? parseUserProfile(html).posts : parsePostList(html);
    const post = posts.find(p => p.id === id);
    expect(post).toBeDefined();
    expect(post!.commentCount).toBe(count);
  });

  it.each(['post-list.html', 'frontpage-popular.html', 'frontpage-all.html', 'comment-search.html', 'user-submitted.html'])(
    'agrees with every exact title count in %s (zero and non-rounded neighbours)',
    (fixture) => {
      const html = loadFixture(fixture);
      const posts = fixture === 'user-submitted.html' ? parseUserProfile(html).posts : parsePostList(html);
      const $ = cheerio.load(html);
      const exact = new Map<string, number>();
      $('.post').each((_i, el) => {
        const $el = $(el);
        const id = $el.attr('id') || '';
        const title = $el.find('.post_comments').first().attr('title') || '';
        const match = title.trim().match(/^(\d[\d,]*)\s+comments?$/i);
        if (id && match) exact.set(id, parseInt(match[1].replace(/,/g, ''), 10));
      });
      expect(exact.size).toBeGreaterThan(0);
      expect(posts.filter(p => exact.has(p.id))).toHaveLength(exact.size);
      for (const post of posts) {
        if (exact.has(post.id)) expect(post.commentCount).toBe(exact.get(post.id));
      }
    },
  );

  type FallbackRow = { name: string; titleAttr?: string; text?: string; expected: number };

  const FALLBACK_ROWS: FallbackRow[] = [
    { name: 'compact display count with no title attribute', text: '3.4k comments', expected: 3400 },
    { name: 'comma display count with no title attribute', text: '1,234 comments', expected: 1234 },
    { name: 'exact title beats a rounded display count', titleAttr: '3426 comments', text: '3.4k comments', expected: 3426 },
    { name: 'exact title with comma grouping', titleAttr: '1,234 comments', text: '1.2k comments', expected: 1234 },
    { name: 'valid zero count', titleAttr: '0 comments', text: '0 comments', expected: 0 },
    { name: 'exact round thousand beats the rounded display', titleAttr: '1000 comments', text: '1.0k comments', expected: 1000 },
    { name: 'one comment (singular)', titleAttr: '1 comment', text: '1 comment', expected: 1 },
    { name: 'unparseable title falls back to the display count', titleAttr: 'Hidden', text: '12 comments', expected: 12 },
    { name: 'missing title and unparseable display keep zero', text: 'comments', expected: 0 },
    { name: 'unsupported display text keeps the previous first-integer semantics', text: '12abc comments', expected: 12 },
    { name: 'absent post_comments element keeps zero', expected: 0 },
  ];

  function fallbackPost(row: FallbackRow): string {
    const comments = row.text === undefined
      ? ''
      : `<div class="post_footer"><a href="/r/test/comments/abc123/t/" class="post_comments"${
          row.titleAttr === undefined ? '' : ` title="${row.titleAttr}"`
        }>${row.text}</a></div>`;
    return `<html><body><div class="post" id="abc123">
      <h2 class="post_title"><a href="/r/test/comments/abc123/t/">Title</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      ${comments}
    </div></body></html>`;
  }

  it.each(FALLBACK_ROWS)('$name', (row) => {
    const posts = parsePostList(fallbackPost(row));
    expect(posts).toHaveLength(1);
    expect(posts[0].commentCount).toBe(row.expected);
  });
});

describe('parsePostDetails', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('post-detail.html');
  });

  it('should return an object with expected keys', () => {
    const result = parsePostDetails(html);
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('author');
    expect(result).toHaveProperty('subreddit');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('body');
    expect(result).toHaveProperty('commentCount');
    expect(result).toHaveProperty('comments');
  });

  it('should parse the post title', () => {
    const result = parsePostDetails(html);
    expect(result.title).toBeTruthy();
    expect(result.title).toContain('closed for new posts');
  });

  it('should parse the author', () => {
    const result = parsePostDetails(html);
    expect(result.author).toBeTruthy();
  });

  it('should parse the subreddit', () => {
    const result = parsePostDetails(html);
    expect(result.subreddit).toBe('announcements');
  });

  it('should normalize the pseudo-subreddit of a profile post (r/u_spez → spez)', () => {
    // On /user/<name>/comments/<id> detail pages redlib renders the post's
    // pseudo-subreddit as r/u_<username>; it must normalize to the bare
    // username, matching parsePostElement on profile listings.
    const profileHtml = `<html><body>
      <h1 class="post_title"><a href="/user/spez/comments/1u7hraf/21_years_of_reddit/">21 years of Reddit</a></h1>
      <span class="post_author">u/spez</span>
      <span class="post_subreddit">r/u_spez</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(profileHtml);
    expect(result.subreddit).toBe('spez');
  });

  it('should keep a normal subreddit label untouched (r/DeepSeek → DeepSeek)', () => {
    const normalHtml = `<html><body>
      <h1 class="post_title"><a href="/r/DeepSeek/comments/1vbj0aa/my_title/">Title</a></h1>
      <span class="post_author">user</span>
      <span class="post_subreddit">r/DeepSeek</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(normalHtml);
    expect(result.subreddit).toBe('DeepSeek');
  });

  it('should leave embedded prefix-like occurrences untouched (anchored semantics)', () => {
    // normalizeSubredditLabel anchors on ^r/, ^u_, ^u/ — it only strips when the
    // label STARTS with a prefix. Values that merely contain one ('xr/DeepSeek',
    // 'ru_spez') must survive verbatim through the shared parsePostElement path.
    const embeddedHtml = `<html><body>
      <div class="post" id="p1">
        <div class="post_title"><a href="/r/DeepSeek/comments/1vbj0aa/my_title/">Title one</a></div>
        <span class="post_subreddit">xr/DeepSeek</span>
        <span class="post_author">user1</span>
        <span class="post_score">10</span>
      </div>
      <div class="post" id="p2">
        <div class="post_title"><a href="/r/DeepSeek/comments/1vbj0ab/my_title/">Title two</a></div>
        <span class="post_subreddit">ru_spez</span>
        <span class="post_author">user2</span>
        <span class="post_score">10</span>
      </div>
    </body></html>`;
    const posts = parsePostList(embeddedHtml);
    expect(posts[0].subreddit).toBe('xr/DeepSeek');
    expect(posts[1].subreddit).toBe('ru_spez');
  });

  it('should normalize a profile post subreddit through the shared post path (r/u_spez → spez)', () => {
    // parsePostElement is shared by parsePostList and parseUserProfile posts;
    // this pins exact equality: 'spez' — not 'u_spez', not 'u/spez'.
    const profileHtml = `<html><body>
      <div class="post" id="p1">
        <div class="post_title"><a href="/user/spez/comments/1u7hraf/21_years_of_reddit/">21 years of Reddit</a></div>
        <span class="post_subreddit">r/u_spez</span>
        <span class="post_author">u/spez</span>
        <span class="post_score">10</span>
      </div>
    </body></html>`;
    const posts = parsePostList(profileHtml);
    expect(posts[0].subreddit).toBe('spez');
  });

  it('should parse score as a number', () => {
    const result = parsePostDetails(html);
    expect(typeof result.score).toBe('number');
  });

  it('should have a comments array', () => {
    const result = parsePostDetails(html);
    expect(Array.isArray(result.comments)).toBe(true);
  });

  it('should limit comments to 10 max by default', () => {
    const result = parsePostDetails(html);
    expect(result.comments.length).toBeLessThanOrEqual(10);
  });

  it('should respect custom comment limit', () => {
    const result = parsePostDetails(html, 3);
    expect(result.comments.length).toBeLessThanOrEqual(3);
  });

  it('should have a numeric commentCount', () => {
    const result = parsePostDetails(html);
    expect(typeof result.commentCount).toBe('number');
  });

  it('should extract non-empty post body text', () => {
    const result = parsePostDetails(html);
    expect(result.body).toBeTruthy();
    expect(result.body).toContain('For more information');
  });

  it('should extract the post id from the post-detail fixture', () => {
    // Fixture has no id attribute on the post div and no title href — the id
    // comes from the derived post path (/comments/t93ec3/...).
    const result = parsePostDetails(html);
    expect(result.id).toBe('t93ec3');
  });

  it('should extract an absolute permalink containing /comments/ from the post-detail fixture', () => {
    const result = parsePostDetails(html);
    expect(result.permalink).toMatch(/^https:\/\/www\.reddit\.com\//);
    expect(result.permalink).toContain('/comments/t93ec3');
  });

  it('should omit id and permalink when there is no post id and no title href', () => {
    const bareHtml = `<html><body>
      <h1 class="post_title">No identifiers here</h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(bareHtml);
    expect(result.id).toBeUndefined();
    expect(result.permalink).toBeUndefined();
  });

  it('should keep an absolute title href verbatim as the permalink (no double prefix)', () => {
    const absoluteHtml = `<html><body>
      <h1 class="post_title"><a href="https://example.com/some/post">External Title</a></h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(absoluteHtml);
    expect(result.permalink).toBe('https://example.com/some/post');
  });

  it('should extract id and prefixed permalink from a relative title href', () => {
    const relativeHtml = `<html><body>
      <h1 class="post_title"><a href="/r/test/comments/abc123/my_title/">My Title</a></h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(relativeHtml);
    expect(result.id).toBe('abc123');
    expect(result.permalink).toBe('https://www.reddit.com/r/test/comments/abc123/my_title/');
  });

  it('should parse comment fields correctly', () => {
    const result = parsePostDetails(html);
    if (result.comments.length > 0) {
      const comment = result.comments[0];
      expect(comment).toHaveProperty('author');
      expect(comment).toHaveProperty('text');
      expect(comment).toHaveProperty('score');
    }
  });

  it('should extract flair when post has a flair link', () => {
    // Use inline HTML with a flair on the post title (like a typical flaired post)
    const flairedHtml = `<html><body>
      <h1 class="post_title">
        <a href="/r/sub/search?q=flair_name%3A%22Test%20Flair%22&restrict_sr=on"
           class="post_flair"
           style="color:white; background:#ff0000;"
           dir="ltr"><span>Test Flair</span></a>
        Actual Post Title Here
      </h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">42</span>
      <div class="post_body">Body text</div>
    </body></html>`;
    const result = parsePostDetails(flairedHtml);
    expect(result.flair).toBeDefined();
    expect(result.flair!.text).toBe('Test Flair');
    expect(result.flair!.text_color).toBe('white');
    expect(result.flair!.bg_color).toBe('#ff0000');
    expect(result.flair!.filter_url).toContain('search?q=flair_name');
    expect(Array.isArray(result.flair!.emoji_urls)).toBe(true);
    // Title should NOT contain the flair text
    expect(result.title).toBe('Actual Post Title Here');
  });

  it('should not have flair when post has no flair link', () => {
    const noFlairHtml = `<html><body>
      <h1 class="post_title">Just a regular title</h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">10</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(noFlairHtml);
    expect(result.flair).toBeUndefined();
  });

  it('should extract flair with emoji urls in post details', () => {
    const emojiFlairHtml = `<html><body>
      <h1 class="post_title">
        <a href="/r/sub/search?q=flair_name%3A%22Custom%22&restrict_sr=on"
           class="post_flair"
           style="color:black; background:#edeff1;"
           dir="ltr">
          <span class="emoji" style="background-image:url('/emoji/abc123');"></span>
          <span> Custom </span>
          <span class="emoji" style="background-image:url('/emoji/def456');"></span>
        </a>
        The Real Title
      </h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">99</span>
      <div class="post_body">Body text here</div>
    </body></html>`;
    const result = parsePostDetails(emojiFlairHtml);
    expect(result.flair).toBeDefined();
    expect(result.flair!.text).toBe('Custom');
    // emoji_urls are absolute against the instance base URL (default http://localhost:8080)
    expect(result.flair!.emoji_urls).toEqual(['http://localhost:8080/emoji/abc123', 'http://localhost:8080/emoji/def456']);
    expect(result.title).toBe('The Real Title');
  });

  it('should not mistake background-color for the flair text color', () => {
    // A leading `background-color` must not satisfy the `color` property
    // match; the real `color` declaration after it is the text color.
    const bgFirstHtml = `<html><body>
      <h1 class="post_title">
        <a href="/r/sub/search?q=flair_name%3A%22Bg%22&restrict_sr=on"
           class="post_flair"
           style="background-color:#123456; color:#ffffff;"
           dir="ltr"><span>Bg</span></a>
        Real Title
      </h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">5</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(bgFirstHtml);
    expect(result.flair).toBeDefined();
    expect(result.flair!.text_color).toBe('#ffffff');
    expect(result.flair!.bg_color).toBeUndefined();
    expect(result.title).toBe('Real Title');
  });

  it('should parse the background shorthand independently of color', () => {
    const shorthandHtml = `<html><body>
      <h1 class="post_title">
        <a href="/r/sub/search?q=flair_name%3A%22Both%22&restrict_sr=on"
           class="post_flair"
           style="background:#112233; color:#445566;"
           dir="ltr"><span>Both</span></a>
        Title
      </h1>
      <span class="post_author">testuser</span>
      <span class="post_subreddit">r/testsub</span>
      <span class="post_score">5</span>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(shorthandHtml);
    expect(result.flair!.text_color).toBe('#445566');
    expect(result.flair!.bg_color).toBe('#112233');
  });

  it('should extract created_utc and created_relative timestamps', () => {
    const result = parsePostDetails(html);
    expect(result.created_utc).toBe('Mar 08 2022, 00:02:48 UTC');
    expect(result.created_relative).toBe("Mar 08 '22");
  });

  it('should extract score_exact from post_score title attribute', () => {
    const result = parsePostDetails(html);
    expect(result.score_exact).toBe(0);
    expect(typeof result.score_exact).toBe('number');
  });

  it('should detect author_flair admin from post_author class', () => {
    // post-detail.html has <a class="post_author admin" ...>
    const result = parsePostDetails(html);
    expect(result.author_flair).toBe('admin');
  });

  it('should not have author_flair for regular authors', () => {
    const noFlairHtml = `<html><body>
      <h1 class="post_title">Regular post</h1>
      <a class="post_author" href="/user/regular">u/regular</a>
      <span class="post_subreddit">r/test</span>
      <div class="post_score" title="42">42</div>
      <div class="post_body">Body</div>
    </body></html>`;
    const result = parsePostDetails(noFlairHtml);
    expect(result.author_flair).toBeUndefined();
  });
});

describe('parsePostDetails with nested comments', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('post-detail-nested-comments.html');
  });

  it('should return top-level comments only at root', () => {
    const result = parsePostDetails(html, 100);
    // 3 top-level comments (c001, c004, c005)
    expect(result.comments.length).toBe(3);
    expect(result.comments[0].id).toBe('c001');
    expect(result.comments[1].id).toBe('c004');
    expect(result.comments[2].id).toBe('c005');
  });

  it('should set depth 0 for top-level comments', () => {
    const result = parsePostDetails(html, 100);
    for (const c of result.comments) {
      expect(c.depth).toBe(0);
    }
  });

  it('should nest replies with correct depth', () => {
    const result = parsePostDetails(html, 100);
    const c001 = result.comments[0];
    expect(c001.replies).toBeDefined();
    expect(c001.replies!.length).toBe(1);
    expect(c001.replies![0].id).toBe('c002');
    expect(c001.replies![0].depth).toBe(1);

    // Deep nested reply
    const c002 = c001.replies![0];
    expect(c002.replies).toBeDefined();
    expect(c002.replies!.length).toBe(1);
    expect(c002.replies![0].id).toBe('c003');
    expect(c002.replies![0].depth).toBe(2);
  });

  it('should detect OP status via comment_author.op class', () => {
    const result = parsePostDetails(html, 100);
    // c001 is by OP
    expect(result.comments[0].author_is_op).toBe(true);
    // c004 is not OP
    expect(result.comments[1].author_is_op).toBe(false);
    // c002 (reply) is not OP
    expect(result.comments[0].replies![0].author_is_op).toBe(false);
    // c003 (deep reply) is OP
    expect(result.comments[0].replies![0].replies![0].author_is_op).toBe(true);
  });

  it('should extract comment IDs from div id attribute', () => {
    const result = parsePostDetails(html, 100);
    expect(result.comments[0].id).toBe('c001');
    expect(result.comments[0].replies![0].id).toBe('c002');
    expect(result.comments[0].replies![0].replies![0].id).toBe('c003');
  });

  it('should extract created_utc and created_relative from a.created', () => {
    const result = parsePostDetails(html, 100);
    const c001 = result.comments[0];
    expect(c001.created_utc).toBe('Jul 01 2026, 12:05:00 UTC');
    expect(c001.created_relative).toBe('5h ago');
  });

  it('should extract public permalink with fragment from a.created href', () => {
    const result = parsePostDetails(html, 100);
    const c001 = result.comments[0];
    // Permalinks are now absolute public URLs: {publicBaseUrl}{postPath}#{fragment}
    expect(c001.permalink).toBe('https://www.reddit.com/r/testsub/comments/abc123/test_post/#c001');
    expect(c001.replies![0].permalink).toBe('https://www.reddit.com/r/testsub/comments/abc123/test_post/#c002');
  });

  it('should parse score with commas', () => {
    const result = parsePostDetails(html, 100);
    // c005 has score "1,234"
    expect(result.comments[2].score).toBe(1234);
  });

  it('should not truncate comment text', () => {
    const result = parsePostDetails(html, 100);
    expect(result.comments[0].text).toBe('Top level comment by OP with full text that is not truncated at all.');
  });

  it('should count ALL comments recursively in commentCount', () => {
    const result = parsePostDetails(html, 100);
    // 5 total: c001, c002, c003, c004, c005
    expect(result.commentCount).toBe(5);
  });

  it('should apply limit to top-level comments only', () => {
    const result = parsePostDetails(html, 2);
    expect(result.comments.length).toBe(2);
    expect(result.comments[0].id).toBe('c001');
    expect(result.comments[1].id).toBe('c004');
    // commentCount still reflects all
    expect(result.commentCount).toBe(5);
  });

  it('should parse author names', () => {
    const result = parsePostDetails(html, 100);
    expect(result.comments[0].author).toBe('u/poster');
    expect(result.comments[1].author).toBe('u/another');
    expect(result.comments[0].replies![0].author).toBe('u/replier1');
  });

  it('should omit replies key when no replies exist', () => {
    const result = parsePostDetails(html, 100);
    // c004 has empty blockquote.replies
    expect(result.comments[1].replies).toBeUndefined();
  });
});

// NSFW and Spoiler detection tests
//
// Flags come from real metadata markup, never from words in the title or the
// flair: `small.nsfw` / `small.spoiler` (current redlib markup) and legacy
// `.nsfw` / `.spoiler` elements inside the scoped title, always outside the
// actual title link and the flair anchor. A bare `NSFW`/`Spoiler` text node is
// accepted only as a direct child of the title container next to an existing
// non-flair title link, and only when it consists solely of flag
// tokens/whitespace. Without such an anchor, plain title words are never a
// flag.
describe('NSFW and Spoiler detection', () => {
  type FlagRow = {
    name: string;
    titleInner: string;
    nsfw?: true;
    spoiler?: true;
    title: string;
  };

  function listPost(titleInner: string): string {
    return `<html><body><div class="post" id="abc123">
      <h2 class="post_title">${titleInner}</h2>
      <span class="post_score" title="100">100</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
  }

  function detailPost(titleInner: string): string {
    return `<html><body>
      <div class="post">
        <h1 class="post_title">${titleInner}</h1>
        <span class="post_author">u/user</span>
        <span class="post_subreddit">r/test</span>
        <span class="post_score" title="42">42</span>
        <div class="post_body">Body</div>
      </div>
    </body></html>`;
  }

  const LIST_ROWS: FlagRow[] = [
    {
      name: 'current small.nsfw after the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        <small class="nsfw">NSFW</small>',
      nsfw: true,
      title: 'Some Post',
    },
    {
      name: 'current small.spoiler after the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        <small class="spoiler">Spoiler</small>',
      spoiler: true,
      title: 'Some Post',
    },
    {
      name: 'legacy span.nsfw after the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        <span class="nsfw">NSFW</span>',
      nsfw: true,
      title: 'Some Post',
    },
    {
      name: 'legacy span.spoiler after the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        <span class="spoiler">Spoiler</span>',
      spoiler: true,
      title: 'Some Post',
    },
    {
      name: 'bare NSFW text node outside the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        NSFW',
      nsfw: true,
      title: 'Some Post',
    },
    {
      name: 'bare Spoiler text node outside the title link',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Spoiler Post</a>\n        Spoiler',
      spoiler: true,
      title: 'Spoiler Post',
    },
    {
      name: 'bare NSFW and Spoiler tokens in one text node',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Some Post</a>\n        NSFW Spoiler',
      nsfw: true,
      spoiler: true,
      title: 'Some Post',
    },
    {
      name: 'title words mentioning NSFW are not a flag',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Why the NSFW policy changed</a>',
      title: 'Why the NSFW policy changed',
    },
    {
      name: 'title words mentioning Spoiler-free are not a flag',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">A Spoiler-free review</a>',
      title: 'A Spoiler-free review',
    },
    {
      name: 'flair text mentioning NSFW is not a flag',
      titleInner: '<a href="/r/test/search?q=flair_name%3A%22NSFW%22" class="post_flair" style="color:white; background:#ff0000;"><span>NSFW</span></a>\n        <a href="/r/test/comments/abc123/some_post/">Actual title</a>',
      title: 'Actual title',
    },
    {
      name: 'nsfw element nested inside the title link is title text, not a flag',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Inside <span class="nsfw">NSFW</span> text</a>',
      title: 'Inside NSFW text',
    },
    {
      name: 'spoiler element nested inside the flair anchor is not a flag',
      titleInner: '<a href="/r/test/search?q=flair_name%3A%22Chat%22" class="post_flair" style="color:white; background:#00ff00;"><span class="spoiler">Spoiler</span></a>\n        <a href="/r/test/comments/abc123/some_post/">Actual title</a>',
      title: 'Actual title',
    },
    {
      name: 'bare flag word wrapped in an element is not a direct text node',
      titleInner: '<a href="/r/test/comments/abc123/some_post/">Actual title</a>\n        <span>NSFW</span>',
      title: 'Actual title',
    },
    {
      name: 'the title anchor itself carrying a legacy nsfw class is not metadata',
      titleInner: '<a class="nsfw" href="/r/demo/comments/abc123/title">Ordinary title</a>',
      title: 'Ordinary title',
    },
    {
      name: 'a flair anchor carrying the nsfw class itself is not metadata',
      titleInner: '<a class="post_flair nsfw" href="/r/demo/search?q=x"><span>Metadata words</span></a><a href="/r/demo/comments/abc123/title">Ordinary title</a>',
      title: 'Ordinary title',
    },
    {
      name: 'a concatenated NSFWSpoiler suffix is not a bare flag',
      titleInner: '<a href="/r/demo/comments/abc123/title">Ordinary title</a> NSFWSpoiler',
      title: 'Ordinary title',
    },
  ];

  it.each(LIST_ROWS)('parsePostList: $name', ({ titleInner, nsfw, spoiler, title }) => {
    const posts = parsePostList(listPost(titleInner));
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe(title);
    expect(posts[0].nsfw).toBe(nsfw);
    expect(posts[0].spoiler).toBe(spoiler);
  });

  const DETAIL_ROWS: FlagRow[] = [
    {
      name: 'current small.nsfw after an anchor-less title',
      titleInner: 'Clean title\n        <small class="nsfw">NSFW</small>',
      nsfw: true,
      title: 'Clean title',
    },
    {
      name: 'current small.spoiler after a flair and anchor-less title',
      titleInner: '<a href="/r/test/search?q=flair_name%3A%22Discussion%22" class="post_flair" style="color:white; background:#ff0000;"><span>Discussion</span></a>\n        Actual title\n        <small class="spoiler">Spoiler</small>',
      spoiler: true,
      title: 'Actual title',
    },
    {
      name: 'both current small tags are excluded from the detail title',
      titleInner: 'Actual title\n        <small class="nsfw">NSFW</small>\n        <small class="spoiler">Spoiler</small>',
      nsfw: true,
      spoiler: true,
      title: 'Actual title',
    },
    {
      name: 'legacy title link plus bare NSFW text node',
      titleInner: '<a href="/r/test/comments/abc/nsfw_post/">Legacy titled post</a>\n          NSFW',
      nsfw: true,
      title: 'Legacy titled post',
    },
    {
      name: 'legacy title link plus bare Spoiler text node',
      titleInner: '<a href="/r/test/comments/abc/spoiler_post/">Legacy titled post</a>\n          Spoiler',
      spoiler: true,
      title: 'Legacy titled post',
    },
    {
      name: 'anchor-less title words mentioning NSFW are not a flag',
      titleInner: 'NSFW: a history',
      title: 'NSFW: a history',
    },
    {
      name: 'anchor-less title words mentioning Spoiler-free are not a flag',
      titleInner: 'Spoiler-free review',
      title: 'Spoiler-free review',
    },
    {
      name: 'flair text mentioning NSFW is not a flag',
      titleInner: '<a href="/r/test/search?q=flair_name%3A%22NSFW%22" class="post_flair" style="color:white; background:#ff0000;"><span>NSFW</span></a>\n        Actual title',
      title: 'Actual title',
    },
    {
      name: 'nsfw element nested inside the title link stays title text',
      titleInner: '<a href="/r/test/comments/abc/nsfw_post/">Inside <span class="nsfw">NSFW</span> text</a>',
      title: 'Inside NSFW text',
    },
    {
      name: 'spoiler element nested inside the flair anchor is not a flag',
      titleInner: '<a href="/r/test/search?q=flair_name%3A%22Chat%22" class="post_flair" style="color:white; background:#00ff00;"><span class="spoiler">Spoiler</span></a>\n        Actual title',
      title: 'Actual title',
    },
    {
      name: 'small.nsfw does not turn title words into a spoiler flag',
      titleInner: 'A spoiler-free guide\n        <small class="nsfw">NSFW</small>',
      nsfw: true,
      title: 'A spoiler-free guide',
    },
    {
      name: 'clean detail title text is preserved verbatim',
      titleInner: 'Just a clean title',
      title: 'Just a clean title',
    },
    {
      name: 'the title anchor itself carrying a legacy nsfw class is not metadata',
      titleInner: '<a class="nsfw" href="/r/demo/comments/abc123/title">Ordinary title</a>',
      title: 'Ordinary title',
    },
    {
      name: 'a flair anchor carrying the nsfw class itself is not metadata',
      titleInner: '<a class="post_flair nsfw" href="/r/demo/search?q=x"><span>Metadata words</span></a><a href="/r/demo/comments/abc123/title">Ordinary title</a>',
      title: 'Ordinary title',
    },
    {
      name: 'a concatenated NSFWSpoiler suffix is not a bare flag and stays in the title',
      titleInner: '<a href="/r/demo/comments/abc123/title">Ordinary title</a> NSFWSpoiler',
      title: 'Ordinary title NSFWSpoiler',
    },
  ];

  it.each(DETAIL_ROWS)('parsePostDetails: $name', ({ titleInner, nsfw, spoiler, title }) => {
    const result = parsePostDetails(detailPost(titleInner));
    expect(result.title).toBe(title);
    expect(result.nsfw).toBe(nsfw);
    expect(result.spoiler).toBe(spoiler);
  });
});

// Author flair detection tests
describe('Author flair detection', () => {
  it('should detect admin author_flair in parsePostList', () => {
    const adminHtml = `<html><body><div class="post" id="xyz123">
      <h2 class="post_title"><a href="/r/test/comments/xyz123/title/">Title</a></h2>
      <span class="post_score" title="10">10</span>
      <a class="post_author admin" href="/u/admin_user">u/admin_user</a>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(adminHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].author_flair).toBe('admin');
  });

  it('should detect moderator author_flair in parsePostList', () => {
    const modHtml = `<html><body><div class="post" id="xyz456">
      <h2 class="post_title"><a href="/r/test/comments/xyz456/title/">Title</a></h2>
      <span class="post_score" title="10">10</span>
      <a class="post_author moderator" href="/u/mod_user">u/mod_user</a>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(modHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].author_flair).toBe('moderator');
  });

  it('should not set author_flair for regular users in parsePostList', () => {
    const regularHtml = `<html><body><div class="post" id="xyz789">
      <h2 class="post_title"><a href="/r/test/comments/xyz789/title/">Title</a></h2>
      <span class="post_score" title="10">10</span>
      <a class="post_author" href="/u/regular_user">u/regular_user</a>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(regularHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].author_flair).toBeUndefined();
  });
});

// Post type detection detailed tests
describe('Post type detection detailed', () => {
  it('should detect self post with post_preview body', () => {
    const html = `<html><body><div class="post" id="aaa111">
      <h2 class="post_title"><a href="/r/test/comments/aaa111/title/">Self Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <div class="post_body post_preview">Preview text</div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('self');
  });

  it('should detect link post with external thumbnail href', () => {
    const html = `<html><body><div class="post" id="aaa222">
      <h2 class="post_title"><a href="/r/test/comments/aaa222/link/">Link Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <a class="post_thumbnail" href="https://example.com/article" rel="nofollow"><span>example.com</span></a>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('link');
  });

  it('should detect self post when thumbnail points to self (comments path)', () => {
    // The thumbnail label is the type evidence (R1); redlib renders "self" for
    // self posts, and the anchor holds the post's own permalink.
    const html = `<html><body><div class="post" id="aaa333">
      <h2 class="post_title"><a href="/r/test/comments/aaa333/self/">Self with thumb</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <a class="post_thumbnail" href="/r/test/comments/aaa333/self/" rel="nofollow"><span>self</span></a>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('self');
  });

  it('should detect image post with post_media_image', () => {
    const html = `<html><body><div class="post" id="aaa444">
      <h2 class="post_title"><a href="/r/test/comments/aaa444/image/">Image Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <div class="post_media_content">
        <a href="/img/test.jpg" class="post_media_image">image</a>
      </div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('image');
  });

  it('should detect video post with post_media_video', () => {
    const html = `<html><body><div class="post" id="aaa555">
      <h2 class="post_title"><a href="/r/test/comments/aaa555/video/">Video Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <div class="post_media_content">
        <video class="post_media_video" controls></video>
      </div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('video');
  });

  it('should detect gallery post from thumbnail span text', () => {
    const html = `<html><body><div class="post" id="aaa666">
      <h2 class="post_title"><a href="/r/test/comments/aaa666/gallery/">Gallery Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <a class="post_thumbnail" href="/r/test/comments/aaa666/gallery/" rel="nofollow">
        <svg></svg>
        <span>gallery</span>
      </a>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('gallery');
  });

  it('should prioritize gallery over self when both are present', () => {
    const html = `<html><body><div class="post" id="aaa777">
      <h2 class="post_title"><a href="/r/test/comments/aaa777/hybrid/">Hybrid Post</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <a class="post_thumbnail" href="/r/test/comments/aaa777/hybrid/" rel="nofollow">
        <span>gallery</span>
      </a>
      <div class="post_body post_preview">Preview text</div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('gallery');
  });
});

// Edge-case tests
describe('parsePostList edge cases', () => {
  it('should return empty array for empty HTML string', () => {
    const posts = parsePostList('');
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBe(0);
  });

  it('should return empty array when HTML has no .post elements', () => {
    const posts = parsePostList('<html><body><div>No posts here</div></body></html>');
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBe(0);
  });

  it('should skip entries without id or title', () => {
    // Malformed HTML with .post divs but missing key fields
    const html = '<div class="post" id=""><div class="post_title"><a></a></div></div>';
    const posts = parsePostList(html);
    expect(posts.length).toBe(0);
  });
});

describe('parsePostDetails edge cases', () => {
  it('should return empty/default values for empty HTML string', () => {
    const result = parsePostDetails('');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('author');
    expect(result.comments).toEqual([]);
    expect(result.commentCount).toBe(0);
  });

  it('should return empty comments array when HTML has no comments', () => {
    const html = '<html><body><div class="post_title">Test Post</div></body></html>';
    const result = parsePostDetails(html);
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments.length).toBe(0);
    expect(result.commentCount).toBe(0);
  });

  it('should keep full comment text without truncation', () => {
    const longText = 'x'.repeat(1500);
    const html = `<html><body>
      <div class="post_title">Test</div>
      <div class="comment">
        <span class="comment_author">user1</span>
        <div class="comment_body"><div class="md">${longText}</div></div>
        <span class="comment_score">10</span>
      </div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.comments[0].text.length).toBe(1500);
  });

  it('should keep full post body without truncation', () => {
    const longBody = 'y'.repeat(3000);
    const html = `<html><body>
      <div class="post_title">Test</div>
      <div class="post_body">${longBody}</div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.body.length).toBe(3000);
  });
});

// parseSubredditSearch tests
describe('parseSubredditSearch', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('subreddit-search.html');
  });

  it('should return an array of subreddits', () => {
    const results = parseSubredditSearch(html);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should parse subreddit names (without r/ prefix)', () => {
    const results = parseSubredditSearch(html);
    expect(results[0].name).toBeTruthy();
    expect(results[0].name).not.toContain('r/');
    expect(results[0].name).toBe('Python');
  });

  it('should parse subscriber counts', () => {
    const results = parseSubredditSearch(html);
    expect(results[0].subscribers).toBeTruthy();
    expect(results[0].subscribers).toContain('Members');
  });

  it('should parse descriptions', () => {
    const results = parseSubredditSearch(html);
    expect(results[0].description).toBeTruthy();
    expect(typeof results[0].description).toBe('string');
  });

  it('should return multiple subreddit results', () => {
    const results = parseSubredditSearch(html);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should have all expected fields on each result', () => {
    const results = parseSubredditSearch(html);
    for (const result of results) {
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('subscribers');
      expect(result).toHaveProperty('description');
      expect(typeof result.name).toBe('string');
      expect(typeof result.subscribers).toBe('string');
      expect(typeof result.description).toBe('string');
    }
  });
});

describe('parseSubredditSearch edge cases', () => {
  it('should return empty array for empty HTML string', () => {
    const results = parseSubredditSearch('');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('should return empty array when HTML has no search_subreddit elements', () => {
    const results = parseSubredditSearch('<html><body><div>No subreddits here</div></body></html>');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});

// parseUserSearch tests
describe('parseUserSearch', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('user-search.html');
  });

  it('should return an array of users', () => {
    const results = parseUserSearch(html);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should parse usernames from comment_link hrefs', () => {
    const results = parseUserSearch(html);
    expect(results[0].username).toBeTruthy();
    expect(results[0].username).toBe('testuser1');
  });

  it('should parse multiple users', () => {
    const results = parseUserSearch(html);
    expect(results.length).toBe(4);
  });

  it('should parse user descriptions when present', () => {
    const results = parseUserSearch(html);
    expect(results[0].description).toBeTruthy();
    expect(results[0].description).toBe('Just a test user who loves testing things.');
  });

  it('should omit description field when body is empty', () => {
    const results = parseUserSearch(html);
    // TestBot42 has empty comment_body
    const bot = results.find((r: any) => r.username === 'TestBot42');
    expect(bot).toBeDefined();
    expect(bot!.description).toBeUndefined();
  });

  it('should handle multiline descriptions', () => {
    const results = parseUserSearch(html);
    const tester = results.find((r: any) => r.username === 'TestingTheTester');
    expect(tester).toBeDefined();
    expect(tester!.description).toContain('Full-stack engineer');
    expect(tester!.description).toContain('Open to collaborations');
  });

  it('should have all expected fields on each result', () => {
    const results = parseUserSearch(html);
    for (const result of results) {
      expect(result).toHaveProperty('username');
      expect(typeof result.username).toBe('string');
      expect(result.username.length).toBeGreaterThan(0);
    }
  });

  it('should skip comments without a valid user href', () => {
    // Comments with empty/missing user hrefs should be skipped
    const malformedHtml = `<html><body>
      <div class="comment">
        <div class="comment_right">
          <a class="comment_link" href="">COMMENT</a>
          <p class="comment_body">no user link</p>
        </div>
      </div>
      <div class="comment">
        <div class="comment_right">
          <a class="comment_link" href="/user/realuser">COMMENT</a>
          <p class="comment_body">valid</p>
        </div>
      </div>
    </body></html>`;
    const results = parseUserSearch(malformedHtml);
    expect(results.length).toBe(1);
    expect(results[0].username).toBe('realuser');
  });

  it('preserves the unchanged legacy users, order and values', () => {
    const results = parseUserSearch(html);
    // user-search.html holds four .comment user results; keep every actual value.
    expect(results.map(r => r.username)).toEqual(['testuser1', 'test_dev', 'TestBot42', 'TestingTheTester']);
    expect(results[0].description).toBe('Just a test user who loves testing things.');
    expect(results[1].description).toBe('Software developer | Open source contributor | Coffee addict');
    expect('description' in results[2]).toBe(false);
    expect(results[3].description).toContain('Full-stack engineer');
    expect(results[3].description).toContain('Open to collaborations!');
  });
});

describe('parseUserSearch with current people cards', () => {
  const BASE = 'https://www.reddit.com';
  let html: string;

  beforeAll(() => {
    html = loadFixture('people-search-cards.html');
  });

  it('returns only user cards, in document order, skipping the subreddit card and More anchor', () => {
    const results = parseUserSearch(html, BASE);
    expect(results).toEqual([{ username: 'Alice_99' }, { username: 'Bob-42' }]);
  });

  it('does not invent a description for a current people card', () => {
    for (const result of parseUserSearch(html, BASE)) {
      expect('description' in result).toBe(false);
    }
  });

  it('requires a user route: subreddit cards and query-only anchors are not users', () => {
    const cards = `<html><body>
      <a href="/r/rust/" class="search_subreddit"><span class="search_subreddit_name">r/rust</span></a>
      <a href="?q=x&type=communities" class="search_subreddit" id="more_subreddits">More</a>
      <a href="/user/" class="search_subreddit"><span class="search_subreddit_name">u/</span></a>
      <a href="" class="search_subreddit"><span class="search_subreddit_name">u/</span></a>
      <a href="/user/carol/comments/abc/title/" class="search_subreddit"><span class="search_subreddit_name">u/carol</span></a>
      <a href="/u/dave?sort=new" class="search_subreddit"><span class="search_subreddit_name">u/dave</span></a>
    </body></html>`;
    expect(parseUserSearch(cards, BASE)).toEqual([{ username: 'dave' }]);
  });

  it('keeps legacy comment results as a positive neighbour on the same page', () => {
    const mixed = `<html><body>
      <div id="search_subreddits">
        <a href="/user/card_user" class="search_subreddit"><span class="search_subreddit_name">u/card_user</span></a>
      </div>
      <div class="comment">
        <div class="comment_right">
          <a class="comment_link" href="/user/legacy_user">COMMENT</a>
          <p class="comment_body">Old-style description</p>
        </div>
      </div>
    </body></html>`;
    expect(parseUserSearch(mixed, BASE)).toEqual([
      { username: 'card_user' },
      { username: 'legacy_user', description: 'Old-style description' },
    ]);
  });
});

describe('parseUserSearch edge cases', () => {
  it('should return empty array for empty HTML string', () => {
    const results = parseUserSearch('');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('should return empty array when HTML has no .comment elements', () => {
    const results = parseUserSearch('<html><body><div>No users here</div></body></html>');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('should return empty array when comments have no user hrefs', () => {
    // This mimics what a broken Redlib instance might return
    const html = `<html><body>
      <div class="comment">
        <a class="comment_link" href="">COMMENT</a>
        <p class="comment_body">some text</p>
      </div>
    </body></html>`;
    const results = parseUserSearch(html);
    expect(results.length).toBe(0);
  });
});

// parseSubredditInfo tests
describe('parseSubredditInfo', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('subreddit-info.html');
  });

  it('should return an object', () => {
    const result = parseSubredditInfo(html);
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should parse the subreddit title from <title> tag', () => {
    const result = parseSubredditInfo(html);
    expect(result.title).toBeTruthy();
    expect(result.title).toBe('rust');
  });

  it('should parse the subreddit description', () => {
    const result = parseSubredditInfo(html);
    expect(result.description).toBeTruthy();
    expect(result.description).toContain('Rust programming language');
    expect(typeof result.description).toBe('string');
  });

  it('should parse rules when present', () => {
    const result = parseSubredditInfo(html);
    expect(result.rules).toBeTruthy();
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.rules!.length).toBeGreaterThan(0);
  });

  it('should have six rules for r/rust sidebar', () => {
    const result = parseSubredditInfo(html);
    expect(result.rules).toBeDefined();
    expect(result.rules!.length).toBe(6);
  });

  it('should include specific known rules', () => {
    const result = parseSubredditInfo(html);
    expect(result.rules).toContain('Observe our code of conduct');
    expect(result.rules).toContain('Submissions must be on-topic');
    expect(result.rules).toContain('Constructive criticism only');
    expect(result.rules).toContain('Keep things in perspective');
    expect(result.rules).toContain('No endless relitigation');
    expect(result.rules).toContain('No low-effort content');
  });
});

describe('parseSubredditInfo edge cases', () => {
  it('should return empty object for empty HTML string', () => {
    const result = parseSubredditInfo('');
    expect(typeof result).toBe('object');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.rules).toBeUndefined();
  });

  it('should return empty object when HTML has no wiki content', () => {
    const result = parseSubredditInfo('<html><body><div>No sidebar</div></body></html>');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.rules).toBeUndefined();
  });

  it('should extract title even without sidebar content', () => {
    const html = '<html><head><title>Sidebar - testsub</title></head><body></body></html>';
    const result = parseSubredditInfo(html);
    expect(result.title).toBe('testsub');
    expect(result.description).toBeUndefined();
  });

  it('should not include rules when there is no Rules section', () => {
    const html = `<html><head><title>Sidebar - minimal</title></head><body>
      <div id="wiki"><div class="md"><p>Just a description</p></div></div>
    </body></html>`;
    const result = parseSubredditInfo(html);
    expect(result.rules).toBeUndefined();
  });
});

// parseSubredditMeta tests
describe('parseSubredditMeta', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('subreddit-main.html');
  });

  it('should return an object', () => {
    const result = parseSubredditMeta(html);
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('should parse the icon URL (absolute against base URL)', () => {
    const result = parseSubredditMeta(html);
    expect(result.icon_url).toBeTruthy();
    expect(result.icon_url).toContain('communityIcon');
    // Relative icon srcs are made absolute against the default instance base URL
    expect(result.icon_url).toMatch(/^http:\/\/localhost:8080\//);
    // Explicit base URL is honored
    const explicit = parseSubredditMeta(html, 'http://127.0.0.1:8080');
    expect(explicit.icon_url).toMatch(/^http:\/\/127\.0\.0\.1:8080\//);
  });

  it('should parse the display title', () => {
    const result = parseSubredditMeta(html);
    expect(result.display_title).toBe('The Rust Programming Language');
  });

  it('should parse the subreddit name', () => {
    const result = parseSubredditMeta(html);
    expect(result.name).toBe('r/rust');
  });

  it('should parse the short description', () => {
    const result = parseSubredditMeta(html);
    expect(result.description_short).toBeTruthy();
    expect(result.description_short).toContain('Rust programming language');
  });

  it('should parse subscriber count', () => {
    const result = parseSubredditMeta(html);
    expect(result.subscribers).toBeTruthy();
    expect(result.subscribers).toMatch(/[\d.]+k?/);
  });

  it('should parse exact subscriber count from title attr', () => {
    const result = parseSubredditMeta(html);
    expect(result.subscribers_exact).toBeTruthy();
    expect(parseInt(result.subscribers_exact!.replace(/,/g, ''), 10)).toBeGreaterThan(0);
  });

  it('should parse active users', () => {
    const result = parseSubredditMeta(html);
    expect(result.active_users).toBeDefined();
  });

  it('should parse exact active users from title attr', () => {
    const result = parseSubredditMeta(html);
    expect(result.active_users_exact).toBeDefined();
  });
});

describe('parseSubredditMeta edge cases', () => {
  it('should return empty object for empty HTML', () => {
    const result = parseSubredditMeta('');
    expect(typeof result).toBe('object');
    expect(result.icon_url).toBeUndefined();
    expect(result.display_title).toBeUndefined();
    expect(result.subscribers).toBeUndefined();
  });

  it('should return empty object when no #subreddit panel', () => {
    const result = parseSubredditMeta('<html><body><div>No panel</div></body></html>');
    expect(result.icon_url).toBeUndefined();
    expect(result.name).toBeUndefined();
  });
});

// parseUserProfile tests
describe('parseUserProfile with overview page', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('user-overview.html');
  });

  it('should return a UserProfile object', () => {
    const result = parseUserProfile(html);
    expect(result).toHaveProperty('username');
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('comments');
  });

  it('should extract username from sidebar', () => {
    const result = parseUserProfile(html);
    expect(result.username).toBe('spez');
  });

  it('should extract karma from sidebar', () => {
    const result = parseUserProfile(html);
    expect(result.karma).toBe('940207');
  });

  it('should extract cake_day from sidebar', () => {
    const result = parseUserProfile(html);
    expect(result.cake_day).toBe("Jun 06 '05");
  });

  it('should extract description from sidebar', () => {
    const result = parseUserProfile(html);
    expect(result.description).toBe('Reddit CEO');
  });

  it('should have both posts and comments on overview page', () => {
    const result = parseUserProfile(html);
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.comments.length).toBeGreaterThan(0);
  });

  it('should parse post data correctly', () => {
    const result = parseUserProfile(html);
    const post = result.posts[0];
    expect(post.id).toBeTruthy();
    expect(post.title).toBeTruthy();
    expect(post.subreddit).toBeTruthy();
    expect(typeof post.score).toBe('number');
    expect(post.permalink).toContain('/comments/');
  });

  it('should parse comment data correctly', () => {
    const result = parseUserProfile(html);
    const comment = result.comments[0];
    expect(comment.text).toBeTruthy();
    expect(typeof comment.score).toBe('number');
    expect(comment.linkTitle).toBeTruthy();
    expect(comment.subreddit).toBeTruthy();
  });

  it('should normalize pseudo-subreddits of comments on profile posts (r/u_spez → spez)', () => {
    // Comments on the user's own profile posts render r/u_spez (fixture
    // comment_subreddit href); they must normalize to the bare username like
    // post subreddits do.
    const result = parseUserProfile(html);
    expect(result.comments.some((c) => c.subreddit === 'spez')).toBe(true);
    expect(result.comments.some((c) => c.subreddit === 'u_spez')).toBe(false);
  });

  it('should extract flair from user posts', () => {
    const result = parseUserProfile(html);
    // user-overview.html has flaired posts from r/redditstock
    const flaired = result.posts.filter(p => p.flair);
    expect(flaired.length).toBeGreaterThan(0);

    // Check the specific flairs: "Speculation" and "News"
    const speculationPost = flaired.find(p => p.flair!.text === 'Speculation');
    expect(speculationPost).toBeDefined();
    if (speculationPost) {
      expect(speculationPost.flair!.bg_color).toBe('#878a8c');
      expect(speculationPost.flair!.text_color).toBe('white');
      expect(speculationPost.flair!.filter_url).toContain('search?q=flair_name');
    }

    const newsPost = flaired.find(p => p.flair!.text === 'News');
    expect(newsPost).toBeDefined();
    if (newsPost) {
      expect(newsPost.flair!.bg_color).toBe('#007bff');
    }
  });

  it('should extract created_utc and created_relative from user posts', () => {
    const result = parseUserProfile(html);
    const post = result.posts[0];
    expect(post.created_utc).toBeTruthy();
    expect(post.created_relative).toBeTruthy();
    expect(post.created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
    // First post in user-overview is "21 years of Reddit" from Jun 16 2026
    expect(post.created_utc).toContain('Jun 16 2026');
  });

  it('should extract created_utc and created_relative from user comments', () => {
    const result = parseUserProfile(html);
    const comment = result.comments[0];
    expect(comment.created_utc).toBeTruthy();
    expect(comment.created_relative).toBeTruthy();
    expect(comment.created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
    // First comment has UTC from Jun 16 2026
    expect(comment.created_utc).toContain('Jun 16 2026');
  });
});

describe('parseUserProfile with submitted page', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('user-submitted.html');
  });

  it('should extract username', () => {
    const result = parseUserProfile(html);
    expect(result.username).toBe('spez');
  });

  it('should have posts but no comments (submitted listing)', () => {
    const result = parseUserProfile(html);
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.comments.length).toBe(0);
  });

  it('should parse post IDs correctly', () => {
    const result = parseUserProfile(html);
    expect(result.posts[0].id).toBeTruthy();
    expect(result.posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should extract created_utc and created_relative from submitted posts', () => {
    const result = parseUserProfile(html);
    const post = result.posts[0];
    expect(post.created_utc).toBeTruthy();
    expect(post.created_relative).toBeTruthy();
    expect(post.created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
  });
});

describe('parseUserProfile with comments page', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('user-comments.html');
  });

  it('should extract username', () => {
    const result = parseUserProfile(html);
    expect(result.username).toBe('spez');
  });

  it('should have comments but no posts (comments listing)', () => {
    const result = parseUserProfile(html);
    expect(result.comments.length).toBeGreaterThan(0);
    expect(result.posts.length).toBe(0);
  });

  it('should parse comment link titles', () => {
    const result = parseUserProfile(html);
    expect(result.comments[0].linkTitle).toBeTruthy();
  });

  it('should extract created_utc and created_relative from comments', () => {
    const result = parseUserProfile(html);
    const comment = result.comments[0];
    expect(comment.created_utc).toBeTruthy();
    expect(comment.created_relative).toBeTruthy();
    expect(comment.created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
  });
});

describe('parseUserProfile edge cases', () => {
  it('should return empty object-like structure for empty HTML string', () => {
    const result = parseUserProfile('');
    expect(result.username).toBe('');
    expect(result.posts).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('should return empty arrays when HTML has no user content', () => {
    const result = parseUserProfile('<html><body><div>No user here</div></body></html>');
    expect(result.username).toBe('');
    expect(result.posts).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('should keep full profile comment text (no truncation)', () => {
    const longText = 'z'.repeat(2500);
    const html = `<html><body><div id="user_title">u</div>
      <div id="posts">
        <div class="comment user-comment">
          <a class="comment_link" title="Some Post" href="/r/test/comments/1/x/">COMMENT</a>
          <div class="md">${longText}</div>
          <span class="comment_score">5</span>
          <span class="comment_subreddit">r/test</span>
        </div>
      </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.comments.length).toBe(1);
    expect(profile.comments[0].text.length).toBe(2500);
  });
});

// Front page tests (get_front_page tool)
describe('parsePostList with popular front page', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('frontpage-popular.html');
  });

  it('should return an array of posts from popular front page', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from popular front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse post titles from popular front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should parse subreddit names from popular front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].subreddit).toBeTruthy();
  });

  it('should parse authors from popular front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].author).toBeTruthy();
  });

  it('should parse score as a number from popular front page', () => {
    const posts = parsePostList(html);
    expect(typeof posts[0].score).toBe('number');
  });

  it('should parse comment count as a number from popular front page', () => {
    const posts = parsePostList(html);
    // 1v81pht displays "15.3k comments" but the exact title is 15335
    expect(posts[0].commentCount).toBe(15335);
  });

  it('should generate permalinks for popular front page posts', () => {
    const posts = parsePostList(html);
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink?.includes('/comments/'));
    expect(postsWithPermalinks.length).toBeGreaterThan(0);
    expect(postsWithPermalinks[0].permalink).toContain('/comments/');
  });

  it('should extract emoji_urls from flairs with emoji spans', () => {
    const posts = parsePostList(html);
    const flaired = posts.filter(p => p.flair);
    expect(flaired.length).toBeGreaterThan(0);

    // Find at least one flair with emoji URLs (frontpage-popular has several)
    const withEmoji = flaired.find(p => p.flair!.emoji_urls.length > 0);
    expect(withEmoji).toBeDefined();
    if (withEmoji) {
      const emojiUrls = withEmoji.flair!.emoji_urls;
      // Each emoji URL from the fixture should contain '/emoji/'
      for (const url of emojiUrls) {
        expect(url).toContain('/emoji/');
      }
    }
  });

  it('should extract flair text even when emoji spans are present', () => {
    const posts = parsePostList(html);
    // Find a flair with text that includes "Good Vibes" (from the emoji fixture)
    const goodVibes = posts.find(p => p.flair?.text?.includes('Good Vibes'));
    // frontpage-popular has a "Good Vibes" flair with emoji
    if (goodVibes) {
      expect(goodVibes.flair!.emoji_urls.length).toBeGreaterThan(0);
    }
  });

  it('should extract created_utc and created_relative from popular front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].created_utc).toBeTruthy();
    expect(posts[0].created_relative).toBeTruthy();
    expect(posts[0].created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
    // frontpage-popular has relative timestamps like "1h ago", "9h ago"
    expect(posts[0].created_relative).toMatch(/\d+h ago/);
  });

  it('should detect stickied posts', () => {
    const posts = parsePostList(html);
    const stickied = posts.filter(p => p.stickied);
    expect(stickied.length).toBeGreaterThan(0);
    // The stickied post is id 1v8bw52 (T-Mobile outage)
    const tmo = posts.find(p => p.id === '1v8bw52');
    expect(tmo).toBeDefined();
    expect(tmo!.stickied).toBe(true);
    // Non-stickied posts should have stickied undefined (not false)
    const nonStickied = posts.find(p => !p.stickied);
    expect(nonStickied).toBeDefined();
    expect(nonStickied!.stickied).toBeUndefined();
  });

  it('should extract score_exact from popular front page', () => {
    const posts = parsePostList(html);
    // First post has exact score 68604
    expect(posts[0].score_exact).toBe(68604);
    expect(typeof posts[0].score_exact).toBe('number');
    // Stickied post has exact score 2175
    const stickied = posts.find(p => p.id === '1v8bw52');
    expect(stickied).toBeDefined();
    expect(stickied!.score_exact).toBe(2175);
  });

  it('should detect gallery post_type from thumbnail span', () => {
    const posts = parsePostList(html);
    // First post (gallery) has <span>gallery</span> in thumbnail
    const galleryPost = posts.find(p => p.id === '1v81pht');
    expect(galleryPost).toBeDefined();
    expect(galleryPost!.post_type).toBe('gallery');
  });

  it('should detect video post_type from post_media_video', () => {
    const posts = parsePostList(html);
    // Post 1v8g414 has post_media_video
    const videoPost = posts.find(p => p.id === '1v8g414');
    expect(videoPost).toBeDefined();
    expect(videoPost!.post_type).toBe('video');
  });

  it('should detect image post_type from post_media_image', () => {
    const posts = parsePostList(html);
    // Post 1v8cch5 has post_media_image
    const imagePost = posts.find(p => p.id === '1v8cch5');
    expect(imagePost).toBeDefined();
    expect(imagePost!.post_type).toBe('image');
  });
});

describe('parsePostList with r/all front page', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('frontpage-all.html');
  });

  it('should return an array of posts from r/all front page', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from r/all front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse post titles from r/all front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should parse subreddit names from r/all front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].subreddit).toBeTruthy();
  });

  it('should parse authors from r/all front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].author).toBeTruthy();
  });

  it('should return null score + score_hidden for hidden scores, numeric otherwise', () => {
    const posts = parsePostList(html);
    // First r/all post has a hidden score (title="Hidden") → honest null contract
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBe(true);
    // Other posts have numeric scores
    const numeric = posts.find(p => typeof p.score === 'number');
    expect(numeric).toBeDefined();
  });

  it('should parse comment count as a number from r/all front page', () => {
    const posts = parsePostList(html);
    // r/all post 1v8a8ds displays "1.4k comments"; exact title is 1411
    const post = posts.find(p => p.id === '1v8a8ds');
    expect(post).toBeDefined();
    expect(post!.commentCount).toBe(1411);
  });

  it('should generate permalinks for r/all front page posts', () => {
    const posts = parsePostList(html);
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink?.includes('/comments/'));
    expect(postsWithPermalinks.length).toBeGreaterThan(0);
    expect(postsWithPermalinks[0].permalink).toContain('/comments/');
  });

  it('should extract created_utc and created_relative from r/all front page', () => {
    const posts = parsePostList(html);
    expect(posts[0].created_utc).toBeTruthy();
    expect(posts[0].created_relative).toBeTruthy();
    expect(posts[0].created_utc).toMatch(/[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}:\d{2} UTC/);
    expect(posts[0].created_relative).toMatch(/\d+h ago/);
  });
});

// parseWikiPage tests
describe('parseWikiPage', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('wiki-page.html');
  });

  it('should return an object with title and content', () => {
    const result = parseWikiPage(html);
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('content');
  });

  it('should parse the page title from <title> tag', () => {
    const result = parseWikiPage(html);
    expect(result.title).toBe('index');
  });

  it('should parse non-empty wiki content', () => {
    const result = parseWikiPage(html);
    expect(result.content).toBeTruthy();
    expect(typeof result.content).toBe('string');
  });

  it('should contain expected wiki content text', () => {
    const result = parseWikiPage(html);
    expect(result.content).toContain('Welcome to the PF Wiki');
    expect(result.content).toContain('Prime Directive');
  });

  it('should have content length appropriate for a wiki page', () => {
    const result = parseWikiPage(html);
    expect(result.content.length).toBeGreaterThan(100);
  });
});

describe('parseWikiPage edge cases', () => {
  it('should return empty title and content for empty HTML string', () => {
    const result = parseWikiPage('');
    expect(result.title).toBe('');
    expect(result.content).toBe('');
  });

  it('should return empty content when HTML has no wiki content', () => {
    const result = parseWikiPage('<html><body><div>No wiki here</div></body></html>');
    expect(result.title).toBe('');
    expect(result.content).toBe('');
  });

  it('should extract title when present but no wiki content', () => {
    const html = '<html><head><title>commontopics - personalfinance</title></head><body></body></html>';
    const result = parseWikiPage(html);
    expect(result.title).toBe('commontopics');
    expect(result.content).toBe('');
  });

  it('should handle title with no dash', () => {
    const html = '<html><head><title>justindex</title></head><body><div id="wiki"><div class="md">some content</div></div></body></html>';
    const result = parseWikiPage(html);
    expect(result.title).toBe('justindex');
    expect(result.content).toBe('some content');
  });

  it('should handle title with multiple dashes', () => {
    const html = '<html><head><title>my-page-name - my-subreddit</title></head><body><div id="wiki"><div class="md wiki">content here</div></div></body></html>';
    const result = parseWikiPage(html);
    expect(result.title).toBe('my-page-name');
    expect(result.content).toBe('content here');
  });
});

describe('parsePostList with the legacy post-shaped comment-search page', () => {
  // comment-search.html is an older capture: it holds 25 .post elements and no
  // comment results at all. It stays useful as a post/card regression, but it
  // proves nothing about comment-search extraction (see parseCommentSearch).
  let html: string;

  beforeAll(() => {
    html = loadFixture('comment-search.html');
  });

  it('should parse comment search results as an array', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse titles from comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should parse subreddit names from comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].subreddit).toBeTruthy();
  });

  it('should parse authors from comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].author).toBeTruthy();
  });

  it('should parse score as a number from comment search results', () => {
    const posts = parsePostList(html);
    expect(typeof posts[0].score).toBe('number');
  });

  it('should generate permalinks for comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBeTruthy();
    expect(posts[0].permalink).toContain('/comments/');
  });

  it('should return at least 20 results from comment search', () => {
    const posts = parsePostList(html);
    expect(posts.length).toBeGreaterThanOrEqual(20);
  });

  it('should extract created timestamps from comment search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].created_utc).toBeTruthy();
    expect(posts[0].created_relative).toBeTruthy();
  });

  it('holds posts only: comment extraction returns an empty list, never relabelled posts', () => {
    expect(parsePostList(html)).toHaveLength(25);
    expect(parseCommentSearch(html)).toEqual([]);
  });
});

describe('parseCommentSearch', () => {
  const BASE = 'http://127.0.0.1:8080';
  let html: string;

  beforeAll(() => {
    html = loadFixture('comment-search-comments.html');
  });

  it('parses every .comment.user-comment result in document order', () => {
    const comments = parseCommentSearch(html, BASE);
    expect(comments).toHaveLength(3);
    expect(comments.map(c => c.author)).toEqual(['u/ferris_fan', 'u/quiet_quokka', 'u/spez']);
    expect(comments.map(c => c.score)).toEqual([94, null, 17]);
  });

  it('freezes exactly the documented fields (no invented id or score_exact)', () => {
    const [first] = parseCommentSearch(html, BASE);
    expect(Object.keys(first).sort()).toEqual([
      'author', 'created_relative', 'created_utc', 'linkTitle', 'media',
      'parent_permalink', 'permalink', 'score', 'subreddit', 'text',
    ]);
    expect('id' in first).toBe(false);
    expect('score_exact' in first).toBe(false);
  });

  it('keeps the supplied link title and resolves the comment permalink against the public base', () => {
    const [first] = parseCommentSearch(html, BASE);
    expect(first.linkTitle).toBe('Borrow checker tales');
    expect(first.permalink).toBe('https://www.reddit.com/r/rust/comments/1abc23/borrow_checker_tales/kk91x2z/');
    expect(first.parent_permalink).toBe('https://www.reddit.com/r/rust/comments/1abc23/');
  });

  it('normalises the subreddit label and keeps the displayed timestamps', () => {
    const [first] = parseCommentSearch(html, BASE);
    expect(first.subreddit).toBe('rust');
    expect(first.created_utc).toBe('Nov 18 2026, 10:00:00 UTC');
    expect(first.created_relative).toBe('4 hours ago');
  });

  it('reads the markdown body (sibling after HTML parsing) and its figure media', () => {
    const [first] = parseCommentSearch(html, BASE);
    expect(first.text).toBe('The borrow checker is right, and the error message says why.');
    expect(first.media).toEqual([{ type: 'image', url: `${BASE}/preview/kk91x2z.jpg` }]);
  });

  it('falls back to the comment body container when no markdown wrapper exists', () => {
    const second = parseCommentSearch(html, BASE)[1];
    expect(second.text).toBe('Plain body without a markdown wrapper.');
    expect(second.media).toBeUndefined();
  });

  it('drops comment segments, query and fragment when deriving the parent permalink', () => {
    const second = parseCommentSearch(html, BASE)[1];
    expect(second.linkTitle).toBe('Context link without a title attribute');
    expect(second.permalink).toBe('https://www.reddit.com/r/test/comments/9zz9yy/some_title/?context=3#qq11ww2');
    expect(second.parent_permalink).toBe('https://www.reddit.com/r/test/comments/9zz9yy/');
  });

  it('reports a hidden score without inventing a number', () => {
    const second = parseCommentSearch(html, BASE)[1];
    expect(second.score).toBeNull();
    expect(second.score_hidden).toBe(true);
    expect('score_exact' in second).toBe(false);
  });

  it('omits the parent permalink when the link is not a Reddit-style comment permalink', () => {
    const third = parseCommentSearch(html, BASE)[2];
    expect(third.permalink).toBe('https://www.reddit.com/user/spez/comments/1u7hraf/21_years_of_reddit/os0o1vi/#os0o1vi');
    expect('parent_permalink' in third).toBe(false);
  });

  it('omits a subreddit the markup does not supply and keeps bare-body media', () => {
    const third = parseCommentSearch(html, BASE)[2];
    expect('subreddit' in third).toBe(false);
    expect(third.text).toBe('And thank you (mod tools suck).');
    expect(third.media).toEqual([{ type: 'image', url: `${BASE}/preview/os0o1vi.jpg` }]);
    expect(third.created_relative).toBe('Jun 16 \'26');
  });

  it('returns an empty list for a valid page with no comment results', () => {
    expect(parseCommentSearch('<html><body><div id="column_one"></div></body></html>', BASE)).toEqual([]);
    expect(parseCommentSearch('', BASE)).toEqual([]);
  });

  it('skips a comment element that carries no author, link or body evidence', () => {
    const stray = '<div class="comment user-comment"><div class="comment_left"></div></div>';
    expect(parseCommentSearch(`<html><body>${stray}</body></html>`, BASE)).toEqual([]);
  });
});

describe('parsePostList with author search results', () => {
  let html: string;

  beforeAll(() => {
    html = loadFixture('author-search.html');
  });

  it('should parse author search results as an array', () => {
    const posts = parsePostList(html);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('should parse post IDs from author search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].id).toBeTruthy();
    expect(posts[0].id).toMatch(/^[a-z0-9]+$/);
  });

  it('should parse titles from author search results', () => {
    const posts = parsePostList(html);
    expect(posts[0].title).toBeTruthy();
  });

  it('should detect admin author_flair in author search results', () => {
    const posts = parsePostList(html);
    // author-search.html has a post by spez with class="post_author admin"
    const adminPost = posts.find(p => p.author_flair === 'admin');
    expect(adminPost).toBeDefined();
  });
});

describe('post media and absolute URLs', () => {
  it('extracts post media URLs from image posts', () => {
    const result = parsePostDetails(loadFixture('post-detail-media.html'), 100, 'http://127.0.0.1:8080');
    expect(result.media?.length).toBeGreaterThan(0);
    expect(result.media![0].url.startsWith('http://127.0.0.1:8080/')).toBe(true);
  });

  it('makes thumbnail_url absolute', () => {
    const posts = parsePostList(loadFixture('frontpage-popular.html'), 'http://127.0.0.1:8080');
    const withThumb = posts.find(p => p.thumbnail_url);
    expect(withThumb).toBeDefined();
    expect(withThumb!.thumbnail_url!.startsWith('http://127.0.0.1:8080/')).toBe(true);
  });

  it('makes flair emoji_urls absolute', () => {
    const html = `<html><body><div class="post" id="e1"><div class="post_title">
      <a href="/r/s/comments/e1/x/" class="post_flair" style="color:black; background:#fff;" dir="ltr">
      <span class="emoji" style="background-image:url('/emoji/abc123');"></span><span>F</span></a>
      <a href="/r/s/comments/e1/x/">Title</a></div>
      <div class="post_score">5</div><div class="post_comments">1 comment</div></div></body></html>`;
    const posts = parsePostList(html, 'http://127.0.0.1:8080');
    expect(posts[0].flair!.emoji_urls[0]).toBe('http://127.0.0.1:8080/emoji/abc123');
  });
});

describe('comment media', () => {
  it('extracts image media from figure/img comments', () => {
    const result = parsePostDetails(loadFixture('comment-with-image.html'), 100, 'http://127.0.0.1:8080');
    const mediaComment = result.comments.find(c => c.id === 'p0tq0qh');
    expect(mediaComment).toBeDefined();
    expect(mediaComment!.media?.length).toBeGreaterThan(0);
    expect(mediaComment!.media![0].type).toBe('image');
    expect(mediaComment!.media![0].url.startsWith('http://127.0.0.1:8080/preview/')).toBe(true);
  });

  it('keeps text comments media-free', () => {
    const result = parsePostDetails(loadFixture('post-detail.html'), 100);
    const withMedia = result.comments.filter(c => c.media && c.media.length > 0);
    expect(withMedia.length).toBe(0);
  });
});

describe('hidden scores', () => {
  it('returns null score + score_hidden on search pages (title="Hidden")', () => {
    const posts = parsePostList(loadFixture('search-hidden-score.html'));
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.score).toBeNull();
      expect(p.score_hidden).toBe(true);
    }
  });

  it('keeps numeric score + no score_hidden on feed pages', () => {
    const posts = parsePostList(loadFixture('post-list.html'));
    expect(typeof posts[0].score).toBe('number');
    expect(posts[0].score_hidden).toBeUndefined();
  });
});

describe('public permalinks', () => {
  it('uses REDLIB_PUBLIC_URL-style base for permalinks when provided', () => {
    const posts = parsePostList(loadFixture('post-list.html'), 'http://127.0.0.1:8080', 'https://www.reddit.com');
    expect(posts[0].permalink.startsWith('https://www.reddit.com')).toBe(true);
  });

  it('defaults permalink base to https://www.reddit.com', () => {
    const posts = parsePostList(loadFixture('post-list.html'), 'http://127.0.0.1:8080');
    expect(posts[0].permalink.startsWith('https://www.reddit.com')).toBe(true);
  });
});

describe('search_posts query builder logic', () => {
  // Test the query construction logic used by search_posts tool
  function buildQuery(query: string, opts?: { flair?: string; author?: string; selftext?: string; self_post_only?: boolean }): string {
    let q = query;
    if (opts?.flair) q = `flair_name:"${opts.flair}" ${q}`;
    if (opts?.author) q = `author:${opts.author} ${q}`;
    if (opts?.selftext) q = `selftext:${opts.selftext} ${q}`;
    if (opts?.self_post_only) q = `self:yes ${q}`;
    return q.trim();
  }

  it('should return plain query with no filters', () => {
    expect(buildQuery('cats')).toBe('cats');
  });

  it('should prepend flair_name filter', () => {
    expect(buildQuery('cats', { flair: 'discussion' })).toBe('flair_name:"discussion" cats');
  });

  it('should prepend author filter', () => {
    expect(buildQuery('test', { author: 'spez' })).toBe('author:spez test');
  });

  it('should prepend selftext filter', () => {
    expect(buildQuery('python', { selftext: 'async' })).toBe('selftext:async python');
  });

  it('should prepend self:yes for self_post_only', () => {
    expect(buildQuery('help', { self_post_only: true })).toBe('self:yes help');
  });

  it('should combine multiple filters', () => {
    const result = buildQuery('test', { flair: 'news', author: 'spez', self_post_only: true });
    expect(result).toContain('flair_name:"news"');
    expect(result).toContain('author:spez');
    expect(result).toContain('self:yes');
    expect(result).toContain('test');
  });

  it('should handle flair with spaces', () => {
    expect(buildQuery('cats', { flair: 'off topic' })).toBe('flair_name:"off topic" cats');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge-case coverage from the code-quality review
// ═══════════════════════════════════════════════════════════════════════════

function postWithScore(scoreMarkup: string): string {
  return `<html><body><div class="post" id="sc1">
    <div class="post_title"><a href="/r/test/comments/sc1/title/">Title</a></div>
    ${scoreMarkup}
    <div class="post_comments">5 comments</div>
  </div></body></html>`;
}

describe('parseScore: compact scores and honest null semantics', () => {
  it('prefers the exact title value over compact text ("68.6k" + title="68604" → 68604)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title="68604">68.6k <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBe(68604);
    expect(posts[0].score_exact).toBe(68604);
    expect(posts[0].score_hidden).toBeUndefined();
  });

  it('parses compact "1.2k" score text without a title', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">1.2k <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBe(1200);
    expect(posts[0].score_exact).toBeUndefined();
  });

  it('parses compact "1.2m" score text without a title', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">1.2m</div>'));
    expect(posts[0].score).toBe(1200000);
  });

  it('parses compact text when the title is present but not an integer', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title="12.5k">12.5k</div>'));
    expect(posts[0].score).toBe(12500);
    expect(posts[0].score_exact).toBeUndefined();
  });

  it('emits null score WITHOUT score_hidden for unparseable text (no title="Hidden")', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">N/A</div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBeUndefined();
  });

  it('emits null score WITHOUT score_hidden when the score element is absent', () => {
    const posts = parsePostList(postWithScore(''));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBeUndefined();
  });

  it('emits null score + score_hidden ONLY for genuine title="Hidden"', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title="Hidden">• <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBe(true);
  });

  it('treats lowercase title="hidden" as a hidden score (case-insensitive)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title="hidden">• <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBe(true);
  });

  it('parses leading-dot compact scores (".5k" → 500)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">.5k</div>'));
    expect(posts[0].score).toBe(500);
  });

  it('rejects trailing-garbage text with the anchored regex ("12abc" → null)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">12abc</div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_exact).toBeUndefined();
  });

  it('parses "68.6k Upvotes" via label stripping (anchored parse)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score">68.6k <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBe(68600);
    expect(posts[0].score_exact).toBeUndefined();
  });

  it('trims padded title attributes (" 68604 " → 68604 exact, no compact fallback)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title=" 68604 ">68.6k <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBe(68604);
    expect(posts[0].score_exact).toBe(68604);
  });

  it('parses negative scores', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title="-5">-5</div>'));
    expect(posts[0].score).toBe(-5);
    expect(posts[0].score_exact).toBe(-5);
  });

  it('parses a numeric leaf inside a mixed-text wrapper ("Upvotes <b>12</b>" → 12)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score"><span class="wrap">Upvotes <b>12</b></span></div>'));
    expect(posts[0].score).toBe(12);
    expect(posts[0].score_exact).toBeUndefined();
  });

  it('rejects a non-numeric leaf the same as bare text ("<span>12abc</span>" → null)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score"><span>12abc</span></div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBeUndefined();
  });

  it('treats whitespace-padded title=" hidden " as a hidden score (trim before check)', () => {
    const posts = parsePostList(postWithScore('<div class="post_score" title=" hidden ">• <span class="label">Upvotes</span></div>'));
    expect(posts[0].score).toBeNull();
    expect(posts[0].score_hidden).toBe(true);
  });
});

describe('URL absolutization edge cases', () => {
  it('keeps protocol-relative thumbnail URLs as-is', () => {
    const html = `<html><body><div class="post" id="u1">
      <div class="post_title"><a href="/r/test/comments/u1/title/">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
      <a class="post_thumbnail" href="https://example.com/x"><svg><image href="//cdn.example.com/t.jpg"/></svg></a>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].thumbnail_url).toBe('//cdn.example.com/t.jpg');
  });

  it('detects uppercase-scheme external URLs (case-insensitive)', () => {
    const html = `<html><body><div class="post" id="u2">
      <div class="post_title"><a href="/r/test/comments/u2/title/">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
      <a class="post_thumbnail" href="HTTPS://EXAMPLE.COM/x"><svg><image href="/preview/p.jpg"/></svg></a>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].external_url).toBe('HTTPS://EXAMPLE.COM/x');
    expect(posts[0].thumbnail_url).toBe('http://localhost:8080/preview/p.jpg');
  });

  it('normalizes a trailing-slash baseUrl (no "//" in absolutized URLs)', () => {
    const html = `<html><body><div class="post" id="u3">
      <div class="post_title"><a href="/r/test/comments/u3/title/">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
      <a class="post_thumbnail" href="https://example.com/x"><svg><image href="/preview/p.jpg"/></svg></a>
    </div></body></html>`;
    const posts = parsePostList(html, 'http://localhost:8080/');
    expect(posts[0].thumbnail_url).toBe('http://localhost:8080/preview/p.jpg');
  });

  it('uses absolute title hrefs as permalinks without double-prefixing', () => {
    const html = `<html><body><div class="post" id="u4">
      <div class="post_title"><a href="https://www.reddit.com/r/test/comments/u4/title/">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBe('https://www.reddit.com/r/test/comments/u4/title/');
  });

  it('normalizes a trailing-slash public base URL in permalinks', () => {
    const html = `<html><body><div class="post" id="u5">
      <div class="post_title"><a href="/r/test/comments/u5/title/">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
    </div></body></html>`;
    const posts = parsePostList(html, 'http://localhost:8080', 'https://www.reddit.com/');
    expect(posts[0].permalink).toBe('https://www.reddit.com/r/test/comments/u5/title/');
  });

  it('omits permalink when the title link has an empty href (no "<base>/" fallback)', () => {
    const html = `<html><body><div class="post" id="u6">
      <div class="post_title"><a href="">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
    </div></body></html>`;
    const posts = parsePostList(html, 'http://localhost:8080', 'https://www.reddit.com');
    expect(posts[0].permalink).toBeUndefined();
  });

  it('omits permalink for a whitespace-only title link href', () => {
    const html = `<html><body><div class="post" id="u7">
      <div class="post_title"><a href="   ">Title</a></div>
      <div class="post_score">10</div><div class="post_comments">1 comment</div>
    </div></body></html>`;
    const posts = parsePostList(html, 'http://localhost:8080', 'https://www.reddit.com');
    expect(posts[0].permalink).toBeUndefined();
  });

  it('leaves an empty flair href unprefixed (filter_url stays "", no "<base>/" fallback)', () => {
    const html = `<html><body><div class="post" id="u8"><div class="post_title">
      <a href="" class="post_flair" style="color:black; background:#fff;" dir="ltr"><span>F</span></a>
      <a href="/r/s/comments/u8/x/">Title</a></div>
      <div class="post_score">5</div><div class="post_comments">1 comment</div></div></body></html>`;
    const posts = parsePostList(html, 'http://localhost:8080', 'https://www.reddit.com');
    expect(posts[0].flair!.filter_url).toBe('');
  });
});

describe('comment media extraction (dedupe, gif heuristic, video branches)', () => {
  const commentHtml = (body: string) => `<html><body>
    <div class="post_title">Post</div><div class="post_author">a</div>
    <div class="post_subreddit">r/t</div><div class="post_body">b</div><div class="post_score">1</div>
    <div class="comment"><span class="comment_author">u</span>
    <div class="comment_body"><div class="md">${body}</div></div>
    <span class="comment_score">5</span></div>
  </body></html>`;

  it('emits ONE media item per figure, preferring img[src] over a[href]', () => {
    const body = '<figure><a href="/img/full.jpg"><img src="/preview/pre/thumb.jpg"/></a></figure>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/preview/pre/thumb.jpg' },
    ]);
  });

  it('falls back to the figure a[href] when there is no img', () => {
    const body = '<figure><a href="/img/only.jpg">link</a></figure>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/img/only.jpg' },
    ]);
  });

  it('classifies .gif URLs as gif even with a query string', () => {
    const body = '<figure><a href="/img/cat.gif?width=640"><img src="/img/cat.gif?width=640"/></a></figure>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'gif', url: 'http://127.0.0.1:8080/img/cat.gif?width=640' },
    ]);
  });

  it('does not classify URLs that merely contain "gif" (e.g. giphy.com) as gif', () => {
    const body = '<img src="https://giphy.com/media/abc123"/>';
    const result = parsePostDetails(commentHtml(body), 100);
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'https://giphy.com/media/abc123' },
    ]);
  });

  it('captures bare img[src] not inside a figure', () => {
    const body = '<p>check this</p><img src="/img/bare.jpg"/>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/img/bare.jpg' },
    ]);
  });

  it('emits ONE media item for a.post_media_image with a nested img (no double-count)', () => {
    const body = '<a class="post_media_image" href="/img/full.jpg"><img src="/preview/thumb.jpg"/></a>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/img/full.jpg' },
    ]);
  });

  it('falls back to the inner img[src] when a.post_media_image has no href', () => {
    const body = '<a class="post_media_image"><img src="/x.jpg"/></a>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/x.jpg' },
    ]);
  });

  it('emits no media for a.post_media_image with neither href nor img', () => {
    const body = '<a class="post_media_image"></a>';
    const result = parsePostDetails(commentHtml(body), 100);
    expect(result.comments[0].media).toBeUndefined();
  });

  it('classifies a figure as gif when the href is .gif even with a static .jpg preview img', () => {
    const body = '<figure><a href="/img/cat.gif"><img src="/preview/static.jpg"/></a></figure>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'gif', url: 'http://127.0.0.1:8080/preview/static.jpg' },
    ]);
  });

  it('emits no media entry for a figure with an empty href and no img', () => {
    const body = '<figure><a href=""></a></figure>';
    const result = parsePostDetails(commentHtml(body), 100);
    expect(result.comments[0].media).toBeUndefined();
  });

  it('captures video from <video><source src/></video>', () => {
    const body = '<video controls><source src="/v/clip.mp4"/></video>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'video', url: 'http://127.0.0.1:8080/v/clip.mp4' },
    ]);
  });

  it('captures video from a direct <video src/>', () => {
    const body = '<video src="/v/direct.mp4" controls></video>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'video', url: 'http://127.0.0.1:8080/v/direct.mp4' },
    ]);
  });

  it('emits no media for text-only comments', () => {
    const result = parsePostDetails(commentHtml('<p>just text</p>'), 100);
    expect(result.comments[0].media).toBeUndefined();
  });

  it('emits one video item, not a fabricated image, for a figure-wrapped video (synthetic)', () => {
    // R1/B-Q2: the figure's anchor href is the video's own source, so the
    // figure must not emit an image for the same asset; the video branch owns
    // the single, correctly typed item.
    const body = '<figure><a href="/vid/x.mp4"><video src="/vid/x.mp4"></video></a></figure>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'video', url: 'http://127.0.0.1:8080/vid/x.mp4' },
    ]);
  });

  it('keeps distinct video elements distinct even when their URLs are equal (synthetic)', () => {
    // Not a URL-dedupe problem: two <video> elements are two assets.
    const body = '<video src="/v/same.mp4"></video><video src="/v/same.mp4"></video>';
    const result = parsePostDetails(commentHtml(body), 100, 'http://127.0.0.1:8080');
    expect(result.comments[0].media).toEqual([
      { type: 'video', url: 'http://127.0.0.1:8080/v/same.mp4' },
      { type: 'video', url: 'http://127.0.0.1:8080/v/same.mp4' },
    ]);
  });
});

describe('comment score honesty (parsePostDetails)', () => {
  it('emits null score + score_hidden for comment_score title="Hidden"', () => {
    const html = `<html><body>
      <div class="post_title">Post</div><div class="post_author">a</div>
      <div class="post_subreddit">r/t</div><div class="post_body">b</div><div class="post_score">1</div>
      <div class="comment"><span class="comment_author">u</span>
      <div class="comment_body"><div class="md">text</div></div>
      <span class="comment_score" title="Hidden">•</span></div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.comments[0].score).toBeNull();
    expect(result.comments[0].score_hidden).toBe(true);
  });

  it('emits null score (no score_hidden) when the comment score element is absent', () => {
    const html = `<html><body>
      <div class="post_title">Post</div><div class="post_author">a</div>
      <div class="post_subreddit">r/t</div><div class="post_body">b</div><div class="post_score">1</div>
      <div class="comment"><span class="comment_author">u</span>
      <div class="comment_body"><div class="md">text</div></div></div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.comments[0].score).toBeNull();
    expect(result.comments[0].score_hidden).toBeUndefined();
  });

  it('parses compact comment scores ("1.2k")', () => {
    const html = `<html><body>
      <div class="post_title">Post</div><div class="post_author">a</div>
      <div class="post_subreddit">r/t</div><div class="post_body">b</div><div class="post_score">1</div>
      <div class="comment"><span class="comment_author">u</span>
      <div class="comment_body"><div class="md">text</div></div>
      <span class="comment_score">1.2k</span></div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.comments[0].score).toBe(1200);
  });
});

describe('postPath fallback (comment permalinks without a title link)', () => {
  it('derives the post path from the first created href even without a trailing slash', () => {
    const html = `<html><body>
      <div class="post_author">a</div>
      <div class="post_subreddit">r/test</div>
      <div class="post_body">b</div><div class="post_score">1</div>
      <div class="comment"><span class="comment_author">u</span>
      <div class="comment_data"><a class="created" href="/r/test/comments/abc123/slug/c001?context=3#c001" title="Jul 01 2026, 12:00:00 UTC">5h ago</a></div>
      <div class="comment_body"><div class="md">text</div></div>
      <span class="comment_score">5</span></div>
    </body></html>`;
    const result = parsePostDetails(html, 100);
    expect(result.comments[0].permalink).toBe('https://www.reddit.com/r/test/comments/abc123/slug/#c001');
  });
});

describe('parseUserProfile: honest comment scores + media fields on posts', () => {
  it('returns null score (no fabricated 0) for unparseable comment scores', () => {
    const html = `<html><body><div id="user_title">u</div>
      <div id="posts">
        <div class="comment user-comment">
          <a class="comment_link" title="Some Post" href="/r/test/comments/1/x/">COMMENT</a>
          <div class="md">my comment</div>
          <span class="comment_score">N/A</span>
          <span class="comment_subreddit">r/test</span>
        </div>
      </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.comments[0].score).toBeNull();
  });

  it('parses compact comment scores on user profiles ("2.5k")', () => {
    const html = `<html><body><div id="user_title">u</div>
      <div id="posts">
        <div class="comment user-comment">
          <a class="comment_link" title="Some Post" href="/r/test/comments/1/x/">COMMENT</a>
          <div class="md">my comment</div>
          <span class="comment_score">2.5k</span>
          <span class="comment_subreddit">r/test</span>
        </div>
      </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.comments[0].score).toBe(2500);
  });

  it('makes comment linkHref absolute against the public base URL', () => {
    const html = `<html><body><div id="user_title">u</div>
      <div id="posts">
        <div class="comment user-comment">
          <a class="comment_link" title="Some Post" href="/r/test/comments/1/slug/c1/#c1">COMMENT</a>
          <div class="md">my comment</div>
          <span class="comment_score">5</span>
          <span class="comment_subreddit">r/test</span>
        </div>
      </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.comments[0].linkHref).toBe('https://www.reddit.com/r/test/comments/1/slug/c1/#c1');
  });

  it('extracts thumbnail_url and external_url from profile posts', () => {
    const html = `<html><body><div id="user_title">u</div>
      <div id="posts">
        <div class="post" id="p1">
          <div class="post_title"><a href="/r/test/comments/p1/title/">Title</a></div>
          <div class="post_score">10</div><div class="post_comments">1 comment</div>
          <a class="post_thumbnail" href="https://example.com/x"><svg><image href="/preview/p1.jpg"/></svg></a>
        </div>
      </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.posts[0].thumbnail_url).toBe('http://localhost:8080/preview/p1.jpg');
    expect(profile.posts[0].external_url).toBe('https://example.com/x');
  });
});

// ---------------------------------------------------------------------------
// Batch B: restored content data (link targets, detail types/media, profile
// comment media, wiki text). Synthetic cases below are built from the pinned
// redlib templates (Nachtalb/redlib 1b608404) and are labelled synthetic; they
// are not recovered or live captures.
// ---------------------------------------------------------------------------

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

const detailShell = (media: string): string => `<html><body><div id="column_one"><div class="post">
  <p class="post_header"><a class="post_subreddit" href="/r/test">r/test</a>
    <a class="post_author" href="/user/someone">u/someone</a>
    <span class="created" title="Jan 01 2026, 00:00:00 UTC">1d ago</span></p>
  <h1 class="post_title"><a href="/r/test/comments/abc123/slug/">Title</a></h1>
  ${media}
  <div class="post_score" title="10">10<span class="label"> Upvotes</span></div>
</div></div></body></html>`;

describe('link targets: external_url on list results', () => {
  it('restores the destination of a Reddit-relative link post from the existing fixture', () => {
    // post-list.html post t93ec3 is a link post whose thumbnail href is the
    // Reddit-relative target "/r/reddit/", not its own permalink.
    const posts = parsePostList(loadFixture('post-list.html'));
    const link = posts.find(p => p.id === 't93ec3');
    expect(link).toBeDefined();
    expect(link!.post_type).toBe('link');
    expect(link!.external_url).toBe('https://www.reddit.com/r/reddit/');
    // The stored permalink of the post itself is a different, longer path.
    expect(link!.permalink).toBe('https://www.reddit.com/r/announcements/comments/t93ec3/this_subreddit_is_closed_for_new_posts_and/');
  });

  it('resolves a relative link target against a configured public base', () => {
    const posts = parsePostList(loadFixture('post-list.html'), 'http://127.0.0.1:8080', 'https://reddit.example');
    const link = posts.find(p => p.id === 't93ec3');
    expect(link!.external_url).toBe('https://reddit.example/r/reddit/');
  });

  it('keeps absolute external targets verbatim (no double prefix)', () => {
    const posts = parsePostList(loadFixture('frontpage-popular.html'));
    const link = posts.find(p => p.id === '1v8080p');
    expect(link).toBeDefined();
    expect(link!.post_type).toBe('link');
    expect(link!.external_url).toBe('https://www.techspot.com/news/113243-professor-invisible-prompt-trap-catches-32-students-cheating.html');
  });

  it('never substitutes the parent post permalink for a gallery post thumbnail', () => {
    // Gallery posts render their own permalink in the thumbnail anchor.
    const posts = parsePostList(loadFixture('post-list.html'));
    const gallery = posts.find(p => p.id === 'hrrh23');
    expect(gallery).toBeDefined();
    expect(gallery!.post_type).toBe('gallery');
    expect(gallery!.external_url).toBeUndefined();
  });

  it('never substitutes the parent post permalink for a self post (synthetic)', () => {
    const html = `<html><body><div class="post" id="self1">
      <h2 class="post_title"><a href="/r/test/comments/self1/title/">Self</a></h2>
      <span class="post_score">3</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="/r/test/comments/self1/title/" rel="nofollow"><span>self</span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    const posts = parsePostList(html);
    expect(posts[0].post_type).toBe('self');
    expect(posts[0].external_url).toBeUndefined();
  });

  it('classifies a link post to a Reddit thread from its domain label (user-submitted.html ipiung)', () => {
    // R1/B-Q1: the thumbnail anchor points at a *different* Reddit thread and
    // its span is the destination domain ("reddit.com"), which the pinned
    // template renders only for link-typed posts. The /comments/ shape of the
    // href alone must not turn this into self.
    const posts = parsePostList(loadFixture('user-submitted.html'));
    const link = posts.find(p => p.id === 'ipiung');
    expect(link).toBeDefined();
    expect(link!.post_type).toBe('link');
    expect(link!.external_url).toBe('https://www.reddit.com/r/announcements/comments/ipitt0/today_were_testing_a_new_way_to_discuss_political/');
    // Unrelated returned fields stay unchanged.
    expect(link!.title).toBe('Today we’re testing a new way to discuss political ads (and announcements)');
    expect(link!.subreddit).toBe('modnews');
    expect(link!.author).toBe('u/spez');
    expect(link!.score).toBe(0);
    expect(link!.score_exact).toBe(0);
    expect(link!.commentCount).toBe(1415);
    expect(link!.permalink).toBe('https://www.reddit.com/r/modnews/comments/ipiung/today_were_testing_a_new_way_to_discuss_political/');
    expect(link!.created_utc).toBe('Sep 09 2020, 16:07:24 UTC');
    expect(link!.created_relative).toBe("Sep 09 '20");
  });

  it('resolves the ipiung destination against a configured public base', () => {
    const posts = parsePostList(loadFixture('user-submitted.html'), 'http://127.0.0.1:8080', 'https://reddit.example');
    const link = posts.find(p => p.id === 'ipiung');
    expect(link!.post_type).toBe('link');
    expect(link!.external_url).toBe('https://reddit.example/r/announcements/comments/ipitt0/today_were_testing_a_new_way_to_discuss_political/');
  });

  it('keeps the real self thread neighbour ipitt0 self and destination-free', () => {
    const posts = parsePostList(loadFixture('post-list.html'));
    const self = posts.find(p => p.id === 'ipitt0');
    expect(self).toBeDefined();
    expect(self!.post_type).toBe('self');
    expect(self!.external_url).toBeUndefined();
    expect(self!.permalink).toBe('https://www.reddit.com/r/announcements/comments/ipitt0/today_were_testing_a_new_way_to_discuss_political/');
  });

  it('keeps the legacy self crosspost pg006s self despite a different-thread thumbnail', () => {
    // Span "self.redditsecurity" is the older capture's domain label for a self
    // post; the anchor points at the parent thread (pfyqqn), not a destination.
    const posts = parsePostList(loadFixture('post-list.html'));
    const self = posts.find(p => p.id === 'pg006s');
    expect(self).toBeDefined();
    expect(self!.post_type).toBe('self');
    expect(self!.external_url).toBeUndefined();
    expect(self!.permalink).toBe('https://www.reddit.com/r/announcements/comments/pg006s/covid_denialism_and_policy_clarifications/');
  });

  it('keeps explicit self and type thumbnail labels out of link classification (synthetic)', () => {
    // The parent's reproduction: a "self" label with an absolute href that is
    // the post's own permalink. The relative form is pinned by the test above.
    const rows: Array<{ label: string; href: string; type: string }> = [
      { label: 'self', href: 'https://www.reddit.com/r/test/comments/self9/title/', type: 'self' },
      { label: 'self', href: '/r/test/comments/self9/title/', type: 'self' },
      { label: 'gallery', href: 'https://www.reddit.com/r/test/comments/self9/title/', type: 'gallery' },
      { label: 'image', href: 'https://www.reddit.com/r/test/comments/self9/title/', type: 'image' },
      { label: 'video', href: 'https://www.reddit.com/r/test/comments/self9/title/', type: 'video' },
      { label: 'gif', href: 'https://www.reddit.com/r/test/comments/self9/title/', type: 'video' },
    ];
    for (const row of rows) {
      const html = `<html><body><div class="post" id="self9">
        <h2 class="post_title"><a href="/r/test/comments/self9/title/">Self</a></h2>
        <span class="post_score">3</span><span class="post_comments">1 comment</span>
        <a class="post_thumbnail" href="${row.href}" rel="nofollow"><span>${row.label}</span></a>
        <div class="post_body post_preview">Body</div>
      </div></body></html>`;
      const posts = parsePostList(html);
      expect({ label: row.label, type: posts[0].post_type, external: posts[0].external_url })
        .toEqual({ label: row.label, type: row.type, external: undefined });
    }
  });

  it('falls back to the href shape when the thumbnail label is empty (synthetic)', () => {
    // Older captures render an empty span; without label evidence the href
    // shape stays the only signal (same-thread relative permalink → self,
    // absolute → link).
    const page = (href: string) => `<html><body><div class="post" id="empty1">
      <h2 class="post_title"><a href="/r/test/comments/empty1/title/">T</a></h2>
      <span class="post_score">5</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="${href}" rel="nofollow"><span></span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    const relative = parsePostList(page('/r/test/comments/empty1/title/'))[0];
    expect(relative.post_type).toBe('self');
    expect(relative.external_url).toBeUndefined();
    const absolute = parsePostList(page('https://example.com/a'))[0];
    expect(absolute.post_type).toBe('link');
    expect(absolute.external_url).toBe('https://example.com/a');
  });

  it('does not emit a list post’s own permalink for media-domain labels (legacy captures, synthetic)', () => {
    // R2: older captures label some non-media posts with a media domain. That is
    // still a domain label (→ link), but an anchor that points at the post's own
    // permalink must never be reported as a destination.
    const page = (label: string, href: string) => `<html><body><div class="post" id="own1">
      <h2 class="post_title"><a href="/r/test/comments/own1/title/">T</a></h2>
      <span class="post_score">5</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="${href}" rel="nofollow"><span>${label}</span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    for (const label of ['i.redd.it', 'v.redd.it']) {
      const relative = parsePostList(page(label, '/r/test/comments/own1/title/'))[0];
      expect({ label, type: relative.post_type, external: relative.external_url })
        .toEqual({ label, type: 'link', external: undefined });
      const absolute = parsePostList(page(label, 'https://www.reddit.com/r/test/comments/own1/title/'))[0];
      expect(absolute.external_url).toBeUndefined();
    }
    // Same suppression under a configured public base (both sides resolve there).
    const configured = parsePostList(page('i.redd.it', '/r/test/comments/own1/title/'), 'http://127.0.0.1:8080', 'https://reddit.example')[0];
    expect(configured.external_url).toBeUndefined();
    // A genuinely different destination keeps its target.
    const other = parsePostList(page('i.redd.it', '/r/other/comments/other1/title/'))[0];
    expect(other.post_type).toBe('link');
    expect(other.external_url).toBe('https://www.reddit.com/r/other/comments/other1/title/');
  });

  it('keeps an external destination whose domain begins with "self." (synthetic)', () => {
    // R2: `self.<subreddit>` is a legacy *type* convention paired with a relative
    // Reddit permalink; a bare `self.` domain with an absolute or
    // protocol-relative href is an external destination.
    const page = (label: string, href: string) => `<html><body><div class="post" id="selfio">
      <h2 class="post_title"><a href="/r/test/comments/selfio/title/">T</a></h2>
      <span class="post_score">5</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="${href}" rel="nofollow"><span>${label}</span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    const rows = [
      { label: 'self.io', href: 'https://self.io/p/1' },
      { label: 'self.com', href: 'https://www.self.com/article' },
      { label: 'self.io', href: '//self.io/p/2' },
    ];
    for (const row of rows) {
      const post = parsePostList(page(row.label, row.href))[0];
      expect({ label: row.label, type: post.post_type, external: post.external_url })
        .toEqual({ label: row.label, type: 'link', external: row.href });
    }
    // Paired neighbour: the legacy convention (relative Reddit permalink) stays self.
    const legacy = parsePostList(page('self.testsub', '/r/testsub/comments/abc/title/'))[0];
    expect(legacy.post_type).toBe('self');
    expect(legacy.external_url).toBeUndefined();
  });

  it('preserves scheme-bearing and protocol-relative destinations verbatim in list output (synthetic)', () => {
    // Passive returned data only: nothing here fetches or follows these URLs.
    const page = (label: string, href: string) => `<html><body><div class="post" id="scheme1">
      <h2 class="post_title"><a href="/r/test/comments/scheme1/title/">T</a></h2>
      <span class="post_score">5</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="${href}" rel="nofollow"><span>${label}</span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    const rows = [
      { label: 'ftp.example', href: 'ftp://ftp.example/file' },
      { label: 'example.test', href: 'mailto:reader@example.test' },
      { label: 'example.com', href: '//example.com/x' },
      { label: 'reddit.com', href: 'https://www.reddit.com/r/other/comments/abc/title/' },
      { label: 'reddit.com', href: '/r/other/comments/abc/title/' },
    ];
    for (const row of rows) {
      const post = parsePostList(page(row.label, row.href))[0];
      const expected = row.href.startsWith('/') && !row.href.startsWith('//')
        ? `https://www.reddit.com${row.href}`
        : row.href;
      expect({ label: row.label, type: post.post_type, external: post.external_url })
        .toEqual({ label: row.label, type: 'link', external: expected });
    }
  });

  it('uses exact destination identity, not origin or post id, for the negative guard (synthetic)', () => {
    const page = (titleHref: string, thumbHref: string) => `<html><body><div class="post" id="ident1">
      <h2 class="post_title"><a href="${titleHref}">T</a></h2>
      <span class="post_score">5</span><span class="post_comments">1 comment</span>
      <a class="post_thumbnail" href="${thumbHref}" rel="nofollow"><span>reddit.com</span></a>
      <div class="post_body post_preview">Body</div>
    </div></body></html>`;
    // A comment/fragment destination inside the same thread is distinct.
    const comment = parsePostList(page('/r/test/comments/own3/title/', '/r/test/comments/own3/title/cm1/#cm1'))[0];
    expect(comment.post_type).toBe('link');
    expect(comment.external_url).toBe('https://www.reddit.com/r/test/comments/own3/title/cm1/#cm1');
    // Same origin, different path is distinct.
    const sibling = parsePostList(page('/r/test/comments/own4/title/', 'https://www.reddit.com/r/test/comments/own4/other_slug/'))[0];
    expect(sibling.external_url).toBe('https://www.reddit.com/r/test/comments/own4/other_slug/');
    // Only a trailing slash differs → the same destination → suppressed.
    const same = parsePostList(page('/r/test/comments/own5/title/', '/r/test/comments/own5/title'))[0];
    expect(same.external_url).toBeUndefined();
    // R3: canonical spellings of the same destination are equivalent for the
    // guard — scheme-relative, scheme/host case, default port — while the
    // emitted string would otherwise stay verbatim.
    const suppressedForms = [
      '//www.reddit.com/r/test/comments/own5/title/',
      'HTTPS://WWW.REDDIT.COM/r/test/comments/own5/title/',
      'https://www.reddit.com:443/r/test/comments/own5/title/',
    ];
    for (const href of suppressedForms) {
      const post = parsePostList(page('/r/test/comments/own5/title/', href))[0];
      expect({ href, external: post.external_url }).toEqual({ href, external: undefined });
    }
    // A protocol-relative destination resolves against the public base scheme.
    const schemeRelativeBase = parsePostList(
      page('/r/test/comments/own5/title/', '//reddit.example/r/test/comments/own5/title/'),
      'http://127.0.0.1:8080',
      'https://reddit.example'
    )[0];
    expect(schemeRelativeBase.external_url).toBeUndefined();
    // Genuinely different destinations are kept: path case is not folded, query
    // and fragment values are significant, and a different host is not aliased.
    const keptForms = [
      'https://www.reddit.com/r/test/comments/OWN5/title/',
      'https://www.reddit.com/r/test/comments/own5/title/?sort=top',
      'https://www.reddit.com/r/test/comments/own5/title/#cm1',
      'https://old.reddit.com/r/test/comments/own5/title/',
    ];
    for (const href of keptForms) {
      const post = parsePostList(page('/r/test/comments/own5/title/', href))[0];
      expect({ href, external: post.external_url }).toEqual({ href, external: href });
    }
  });

  it('applies the same link classification to profile posts (user-submitted.html ipiung)', () => {
    const profile = parseUserProfile(loadFixture('user-submitted.html'));
    const link = profile.posts.find(p => p.id === 'ipiung');
    expect(link).toBeDefined();
    expect(link!.post_type).toBe('link');
    expect(link!.external_url).toBe('https://www.reddit.com/r/announcements/comments/ipitt0/today_were_testing_a_new_way_to_discuss_political/');
  });
});

describe('link targets: external_url on detail results', () => {
  it('restores #post_url from the existing detail fixture (Reddit-relative)', () => {
    const result = parsePostDetails(loadFixture('post-detail.html'));
    expect(result.post_type).toBe('link');
    expect(result.external_url).toBe('https://www.reddit.com/r/reddit/');
    expect(result.external_url).not.toBe(result.permalink);
  });

  it('resolves a relative #post_url against a configured public base (synthetic)', () => {
    const html = detailShell('<a id="post_url" href="/r/reddit/" rel="nofollow">/r/reddit/</a>');
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080', 'https://reddit.example');
    expect(result.external_url).toBe('https://reddit.example/r/reddit/');
  });

  it('keeps an absolute #post_url verbatim (synthetic)', () => {
    const html = detailShell('<a id="post_url" href="https://example.com/a?b=1#frag" rel="nofollow">https://example.com/a?b=1#frag</a>');
    const result = parsePostDetails(html);
    expect(result.external_url).toBe('https://example.com/a?b=1#frag');
  });

  it('omits external_url when the #post_url anchor is absent (synthetic)', () => {
    const result = parsePostDetails(detailShell('<div class="post_body"><p>Body</p></div>'));
    expect(result.external_url).toBeUndefined();
    // The post permalink is still available and is not reused as a destination.
    expect(result.permalink).toBe('https://www.reddit.com/r/test/comments/abc123/slug/');
  });

  it('omits external_url when the #post_url href is empty (synthetic)', () => {
    const result = parsePostDetails(detailShell('<a id="post_url" href="" rel="nofollow"></a>'));
    expect(result.external_url).toBeUndefined();
  });

  it('preserves scheme-bearing and protocol-relative #post_url values verbatim (synthetic)', () => {
    // R2: #post_url is returned data, never fetched; only path-relative values
    // are resolved against the public base.
    const rows = [
      { href: 'ftp://ftp.example/file' },
      { href: 'mailto:reader@example.test' },
      { href: '//example.com/x' },
      { href: 'https://example.com/a?b=1#frag' },
    ];
    for (const row of rows) {
      const result = parsePostDetails(detailShell(`<a id="post_url" href="${row.href}" rel="nofollow">${row.href}</a>`));
      expect({ href: row.href, external: result.external_url })
        .toEqual({ href: row.href, external: row.href });
    }
  });
});

describe('detail post types: self/link/gallery/image/video forms', () => {
  it('classifies a body-only detail post as self (synthetic)', () => {
    const result = parsePostDetails(detailShell('<div class="post_body"><div class="md"><p>Body text.</p></div></div>'));
    expect(result.post_type).toBe('self');
  });

  it('classifies the existing image detail fixture as image with one media item', () => {
    const result = parsePostDetails(loadFixture('post-detail-media.html'), 100, 'http://127.0.0.1:8080');
    expect(result.post_type).toBe('image');
    expect(result.media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/img/14by367z3mgh1.jpeg' },
    ]);
  });

  it('classifies a gallery detail post and keeps every gallery image (synthetic)', () => {
    const html = detailShell(`<div class="gallery">
      <figure><a href="/img/a1.jpg"><img src="/img/a1.jpg"/></a>
        <figcaption><p>First</p><p><a class="outbound_url" href="https://example.com/one" rel="nofollow">https://example.com/one</a></p></figcaption>
      </figure>
      <figure><a href="/img/a2.jpg"><img src="/img/a2.jpg"/></a>
        <figcaption><p>Second</p></figcaption>
      </figure>
    </div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.post_type).toBe('gallery');
    expect(result.media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/img/a1.jpg' },
      { type: 'image', url: 'http://127.0.0.1:8080/img/a2.jpg' },
    ]);
    expect(result.external_url).toBeUndefined();
  });

  it('classifies a video detail post from post_media_video (synthetic)', () => {
    const html = detailShell('<div class="post_media_content"><video class="post_media_video" src="/v/clip.mp4" controls></video></div>');
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.post_type).toBe('video');
    expect(result.media).toEqual([{ type: 'video', url: 'http://127.0.0.1:8080/v/clip.mp4' }]);
  });

  it('leaves post_type absent for a marker-less page (synthetic; redlib emits a body div on every detail post)', () => {
    const html = `<html><body><div class="post">
      <p class="post_header"><a class="post_subreddit" href="/r/test">r/test</a></p>
      <h1 class="post_title"><a href="/r/test/comments/abc123/slug/">Title</a></h1>
      <div class="post_score" title="1">1</div>
    </div></body></html>`;
    const result = parsePostDetails(html);
    expect(result.post_type).toBeUndefined();
  });
});

describe('detail media: decorative header/title/thumbnail/award markup is excluded', () => {
  it('keeps body media while dropping award, title-tag, flair and thumbnail images (synthetic)', () => {
    const html = `<html><body><div class="post">
      <p class="post_header">
        <a class="post_subreddit" href="/r/test">r/test</a>
        <a class="post_author" href="/user/someone">u/someone</a>
        <span class="awards"><span class="award" title="Gold"><img alt="Gold" src="/preview/award-gold.png" width="16" height="16"/></span></span>
      </p>
      <h1 class="post_title">
        <a class="post_flair" href="/r/test/search?q=flair_name%3A%22Discussion%22&amp;restrict_sr=on" style="color:#fff; background:#000"><span class="emoji" style="background-image:url('/emoji/discussion')"></span>Discussion<img class="flair_emoji" src="/emoji/legacy-flair.png" alt=""/></a>
        <a href="/r/test/comments/abc123/slug/">Real Title</a> <small class="nsfw">NSFW</small>
      </h1>
      <a class="post_thumbnail" href="/r/test/comments/abc123/slug/" rel="nofollow"><img src="/preview/thumb.jpg" alt="Thumbnail"/></a>
      <div class="post_body"><div class="md"><p>Body</p>
        <figure><a href="/img/body.jpg"><img src="/preview/body.jpg" alt="Post image"/></a></figure>
      </div></div>
      <div class="post_score" title="5">5</div>
      <div class="post_footer"><ul id="post_links"><li><a href="/r/test/comments/abc123/slug/">permalink</a></li></ul></div>
    </div></body></html>`;
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([
      { type: 'image', url: 'http://127.0.0.1:8080/preview/body.jpg' },
    ]);
    expect(result.title).toBe('Real Title');
    expect(result.nsfw).toBe(true);
  });

  it('keeps a bare body image on a detail page (synthetic)', () => {
    const html = detailShell('<div class="post_body"><div class="md"><p>Look:</p><img src="/img/bare.jpg"/></div></div>');
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([{ type: 'image', url: 'http://127.0.0.1:8080/img/bare.jpg' }]);
  });

  it('does not turn the comment thread into post-level media', () => {
    const result = parsePostDetails(loadFixture('comment-with-image.html'), 100, 'http://127.0.0.1:8080');
    expect(result.media).toBeUndefined();
    const mediaComment = result.comments.find(c => c.id === 'p0tq0qh');
    expect(mediaComment!.media).toHaveLength(1);
  });
});

describe('video renditions: one logical item per video', () => {
  it('prefers the MP4 source over the HLS source of the same video (synthetic)', () => {
    const html = detailShell(`<div class="post_media_content"><video class="post_media_video" poster="/p.jpg" preload="none" controls>
      <source src="/hls/clip.m3u8" type="application/vnd.apple.mpegurl" />
      <source src="/v/clip.mp4" type="video/mp4" />
    </video></div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([{ type: 'video', url: 'http://127.0.0.1:8080/v/clip.mp4' }]);
  });

  it('prefers the MP4 source by extension when the type attribute is missing (synthetic)', () => {
    const html = detailShell(`<div class="post_media_content"><video class="post_media_video" controls>
      <source src="/hls/clip.m3u8" type="application/vnd.apple.mpegurl" />
      <source src="/v/clip.mp4" />
    </video></div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([{ type: 'video', url: 'http://127.0.0.1:8080/v/clip.mp4' }]);
  });

  it('prefers a direct video src over its sources (synthetic)', () => {
    const html = detailShell(`<div class="post_media_content"><video class="post_media_video" src="/v/direct.mp4" controls>
      <source src="/v/alt.mp4" type="video/mp4" />
    </video></div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([{ type: 'video', url: 'http://127.0.0.1:8080/v/direct.mp4' }]);
  });

  it('uses the first usable source when no MP4 rendition exists (synthetic)', () => {
    const html = detailShell(`<div class="post_media_content"><video class="post_media_video" controls>
      <source src="/hls/only.m3u8" type="application/vnd.apple.mpegurl" />
      <source src="" />
    </video></div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([{ type: 'video', url: 'http://127.0.0.1:8080/hls/only.m3u8' }]);
  });

  it('keeps two distinct videos as two media items (synthetic)', () => {
    const html = detailShell(`<div class="post_media_content">
      <video class="post_media_video" src="/v/one.mp4" controls></video>
      <video class="post_media_video" src="/v/two.mp4" controls></video>
    </div>`);
    const result = parsePostDetails(html, 10, 'http://127.0.0.1:8080');
    expect(result.media).toEqual([
      { type: 'video', url: 'http://127.0.0.1:8080/v/one.mp4' },
      { type: 'video', url: 'http://127.0.0.1:8080/v/two.mp4' },
    ]);
  });
});

describe('profile comment media', () => {
  it('adds the figure image to profile comments and preserves the other fields', () => {
    const profile = parseUserProfile(loadFixture('user-comments.html'), 'http://127.0.0.1:8080');
    expect(profile.comments).toHaveLength(25);
    expect(profile.comments[3].media).toEqual([
      {
        type: 'image',
        url: 'http://127.0.0.1:8080/preview/pre/f1xjmxgj3d5h1.jpeg?width=1260&format=pjpg&auto=webp&s=37fed0dc065a6553fa7a291f643bf95b60907962',
      },
    ]);
    expect(profile.comments[3].text).toBe('Juuuust kidding. We’ll follow up with the hoodie plan.');
    expect(profile.comments[3].score).toBe(26);
    expect(profile.comments[3].linkTitle).toBe('Steve, Jen, and Drew here — Ask Us Anything!');
    expect(profile.comments[3].linkHref).toBe('https://www.reddit.com/r/RDDT/comments/1tvs5jj/steve_jen_and_drew_here_ask_us_anything/optfyql/#optfyql');
    expect(profile.comments[3].subreddit).toBe('RDDT');
    expect(profile.comments[3].created_utc).toBe('Jun 05 2026, 00:51:55 UTC');
    expect(profile.comments[3].created_relative).toBe("Jun 05 '26");
  });

  it('extracts media for each media-bearing profile comment only', () => {
    const profile = parseUserProfile(loadFixture('user-comments.html'), 'http://127.0.0.1:8080');
    const withMedia = profile.comments.map((c, i) => ({ i, c })).filter(({ c }) => c.media && c.media.length > 0);
    expect(withMedia.map(({ i }) => i)).toEqual([3, 4]);
    expect(profile.comments[4].media).toEqual([
      {
        type: 'image',
        url: 'http://127.0.0.1:8080/preview/pre/6j6mqriszc5h1.jpeg?width=1260&format=pjpg&auto=webp&s=d6ef9851633a7012a76d420b0ed7255d82dc950d',
      },
    ]);
    expect(profile.comments[0].media).toBeUndefined();
  });

  it('keeps text-only profile comments media-free and text unchanged (synthetic)', () => {
    const html = `<html><body><div id="user_title">u</div><div id="posts">
      <div class="comment user-comment">
        <a class="comment_link" title="Some Post" href="/r/test/comments/1/x/">COMMENT</a>
        <p class="comment_body"><div class="md"><p>plain text only</p></div></p>
        <span class="comment_score">5</span>
      </div>
    </div></body></html>`;
    const profile = parseUserProfile(html);
    expect(profile.comments[0].text).toBe('plain text only');
    expect(profile.comments[0].media).toBeUndefined();
  });
});

describe('wiki text: generated TOC removed before text extraction', () => {
  it('drops the generated table of contents and keeps body headings once', () => {
    const result = parseWikiPage(loadFixture('wiki-page.html'));
    expect(result.content.split('\n')[0]).toBe('Welcome to the PF Wiki');
    expect(result.content.startsWith('Welcome to the PF WikiPlease')).toBe(false);
    expect(countOf(result.content, 'Welcome to the PF Wiki')).toBe(1);
    expect(countOf(result.content, 'Prime Directive: How to Handle $')).toBe(1);
    expect(countOf(result.content, 'Miscellaneous Topics')).toBe(1);
    expect(countOf(result.content, 'Reading List')).toBe(1);
    // Legitimately repeated body headings stay repeated.
    expect(countOf(result.content, 'New User Orientation')).toBe(2);
    expect(countOf(result.content, 'Subreddit Rules')).toBe(2);
  });

  it('separates block content without a markdown renderer (synthetic)', () => {
    const html = `<html><head><title>page - sub</title></head><body><div id="wiki"><div class="md wiki">
      <div class="toc"><ul><li><a href="#wiki_a">A</a></li><li><a href="#wiki_b">B</a></li></ul></div><h1 id="wiki_a">A</h1><p>First paragraph.</p><h2 id="wiki_b">B</h2><ul><li>One</li><li>Two</li></ul>
    </div></div></body></html>`;
    const result = parseWikiPage(html);
    expect(result.content).toBe('A\nFirst paragraph.\nB\nOne\nTwo');
  });

  it('keeps the words "toc" and body link lists that are not the generated TOC (synthetic)', () => {
    const html = `<html><head><title>page - sub</title></head><body><div id="wiki"><div class="md">
      <p>Read the toc note first.</p><ul><li><a href="/r/test/wiki/one">One</a></li><li><a href="/r/test/wiki/two">Two</a></li></ul>
    </div></div></body></html>`;
    const result = parseWikiPage(html);
    expect(result.content).toBe('Read the toc note first.\nOne\nTwo');
  });
});
