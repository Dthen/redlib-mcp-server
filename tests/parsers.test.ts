import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePostList, parsePostDetails, parseSubredditSearch, parseUserSearch, parseSubredditInfo, parseSubredditMeta, parseUserProfile, parseWikiPage, CommentData } from '../src/parsers.js';

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
    expect(typeof posts[0].commentCount).toBe('number');
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
    expect(typeof posts[0].commentCount).toBe('number');
  });

  it('should generate permalinks for sorted posts', () => {
    const posts = parsePostList(html);
    expect(posts[0].permalink).toBeTruthy();
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink.includes('/comments/'));
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
    expect(typeof posts[0].commentCount).toBe('number');
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
describe('NSFW and Spoiler detection', () => {
  it('should detect NSFW in post title for parsePostList', () => {
    const nsfwHtml = `<html><body><div class="post" id="abc123">
      <h2 class="post_title">
        <a href="/r/test/comments/abc123/some_post/">Some Post</a>
        <span class="nsfw">NSFW</span>
      </h2>
      <span class="post_score" title="100">100</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(nsfwHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].nsfw).toBe(true);
    expect(posts[0].spoiler).toBeUndefined();
  });

  it('should detect Spoiler in post title for parsePostList', () => {
    const spoilerHtml = `<html><body><div class="post" id="abc456">
      <h2 class="post_title">
        <a href="/r/test/comments/abc456/spoiler_post/">Spoiler Post</a>
        Spoiler
      </h2>
      <span class="post_score" title="50">50</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(spoilerHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].spoiler).toBe(true);
    expect(posts[0].nsfw).toBeUndefined();
  });

  it('should detect NSFW in post title for parsePostDetails', () => {
    const nsfwHtml = `<html><body>
      <div class="post">
        <h1 class="post_title">
          <a href="/r/test/comments/abc/nsfw_post/">NSFW Post</a>
          NSFW
        </h1>
        <span class="post_author">u/user</span>
        <span class="post_subreddit">r/test</span>
        <span class="post_score" title="42">42</span>
        <div class="post_body">Body</div>
      </div>
    </body></html>`;
    const result = parsePostDetails(nsfwHtml);
    expect(result.nsfw).toBe(true);
    expect(result.spoiler).toBeUndefined();
  });

  it('should detect Spoiler in post title for parsePostDetails', () => {
    const spoilerHtml = `<html><body>
      <div class="post">
        <h1 class="post_title">
          <a href="/r/test/comments/abc/spoiler_post/">Spoiler Post</a>
          Spoiler
        </h1>
        <span class="post_author">u/user</span>
        <span class="post_subreddit">r/test</span>
        <span class="post_score" title="42">42</span>
        <div class="post_body">Body</div>
      </div>
    </body></html>`;
    const result = parsePostDetails(spoilerHtml);
    expect(result.spoiler).toBe(true);
    expect(result.nsfw).toBeUndefined();
  });

  it('should not detect NSFW when text appears in normal title words', () => {
    const cleanHtml = `<html><body><div class="post" id="abc789">
      <h2 class="post_title">
        <a href="/r/test/comments/abc789/clean/">Clean Post Title</a>
      </h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
    </div></body></html>`;
    const posts = parsePostList(cleanHtml);
    expect(posts.length).toBe(1);
    expect(posts[0].nsfw).toBeUndefined();
    expect(posts[0].spoiler).toBeUndefined();
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
    const html = `<html><body><div class="post" id="aaa333">
      <h2 class="post_title"><a href="/r/test/comments/aaa333/self/">Self with thumb</a></h2>
      <span class="post_score" title="10">10</span>
      <span class="post_author">u/user</span>
      <span class="post_subreddit">r/test</span>
      <a class="post_thumbnail" href="/r/test/comments/aaa333/self/" rel="nofollow"><span>image</span></a>
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

  it('should limit post body to 2000 characters', () => {
    const longBody = 'y'.repeat(3000);
    const html = `<html><body>
      <div class="post_title">Test</div>
      <div class="post_body">${longBody}</div>
    </body></html>`;
    const result = parsePostDetails(html);
    expect(result.body.length).toBeLessThanOrEqual(2000);
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
    expect(typeof posts[0].commentCount).toBe('number');
  });

  it('should generate permalinks for popular front page posts', () => {
    const posts = parsePostList(html);
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink.includes('/comments/'));
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
    expect(typeof posts[0].commentCount).toBe('number');
  });

  it('should generate permalinks for r/all front page posts', () => {
    const posts = parsePostList(html);
    // Some posts may be flair-filter links, but most should have /comments/ permalinks
    const postsWithPermalinks = posts.filter(p => p.permalink.includes('/comments/'));
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

describe('parsePostList with comment search results', () => {
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
