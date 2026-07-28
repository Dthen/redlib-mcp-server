# Redlib MCP Server — HTML-to-Parser Gap Analysis

**Date:** 2026-07-28 | **Redlib version:** 0.36.0 | **Test instance:** http://127.0.0.1:8080

---

## 1. POST LISTINGS (`.post` on search, subreddit, front page, user pages)

### Currently extracted by `parsePostList()`:
| Field | CSS Selector | 
|-------|-------------|
| id | `.post[id]` or from permalink href |
| title | `.post_title a:not(.post_flair)` text |
| subreddit | `.post_subreddit` text |
| author | `.post_author` text |
| score | `.post_score` text |
| commentCount | `.post_comments` first, regex `\d+` |
| permalink | `.post_title a:not(.post_flair)` href |

### MISSING — High Priority

| # | Missing Field | CSS Selector | Location in HTML | 
|---|--------------|-------------|-----------------|
| 1 | **flair.text** | `a.post_flair span` (non-emoji spans) | `.post_title a.post_flair` — parser explicitly skips with `.not('.post_flair')` |
| 2 | **flair.background_color** | `a.post_flair` style attr → `background:#edeff1` | Same element |
| 3 | **flair.text_color** | `a.post_flair` style attr → `color:black` | Same element |
| 4 | **flair.filter_url** | `a.post_flair` href attr → `/r/:sub/search?q=flair_name%3A%22...%22` | Same element |
| 5 | **flair.emoji_urls** | `a.post_flair span.emoji` style attr → `background-image:url('...')` | Same element |
| 6 | **created** | `span.created` title attr → `"Jul 27 2026, 22:55:44 UTC"` | `.post_header` |
| 7 | **created_relative** | `span.created` text → `"1h ago"` | Same element |
| 8 | **stickied** | `.post.stickied` — presence of `stickied` class on `.post` div | Root div |
| 9 | **author_flair** (moderator/admin) | `a.post_author.moderator` or `a.post_author.admin` class | `.post_header` |
| 10 | **post_type** (link/self/image/video/gallery) | See detection logic below | Various |
| 11 | **thumbnail_url** | `a.post_thumbnail svg image` href attr | `.post_thumbnail` |
| 12 | **external_url** (for link posts) | `a.post_thumbnail` href (external URL) | `.post_thumbnail` |
| 13 | **score_exact** | `.post_score` title attr → `"69875"` | `.post_score` |
| 14 | **media_type** (image/video/gallery/none) | `.post_media_content` → `.post_media_image` / `.post_media_video` / `a.post_thumbnail span` (text="gallery") | After `.post_title` |

### Post Type Detection Logic:
```
self post:    No .post_thumbnail AND no .post_media_content (or .post_body.post_preview has content)
link post:   a.post_thumbnail exists with external href
image post:  .post_media_content > a.post_media_image exists
video post:  .post_media_content > video.post_media_video exists  
gallery:     a.post_thumbnail > span text = "gallery"
```

### MISSING — Nice-to-Have (not in Redlib HTML at all in current version)
|| # | Field | Notes |
||---|-------|-------|
|| — | locked | `locked` class on `.post` — not seen in sample but Redlib may expose it |
|| — | domain | Not directly exposed in Redlib HTML |
|| — | commentCount_exact | `.post_comments` title attr has exact count: `title="228 comments"` |

---

## 2. POST DETAIL PAGES (comments pages)

### Currently extracted by `parsePostDetails()`:
| Field | CSS Selector |
|-------|-------------|
| title | `.post_title` first text |
| author | `.post_author` first |
| subreddit | `.post_subreddit` first |
| score | `.post_score` first |
| body | `.post_body` first text |
| commentCount | `.comment` length |
| comments[].author | `.comment_author` text |
| comments[].text | `.comment_body .md` text |
| comments[].score | `.comment_score` text |

### MISSING — High Priority

| # | Missing Field | CSS Selector | Location |
|---|--------------|-------------|----------|
| 1 | **flair** (same as post list) | `h1.post_title a.post_flair` | Post header |
| 2 | **created** | `.post_header span.created` title attr | Post header |
| 3 | **created_relative** | `.post_header span.created` text | Post header |
| 4 | **upvote_ratio** | `.post_footer > p` text → `"95% Upvoted"` (text before `<span id="upvoted">`) | Post footer |
| 5 | **score_exact** | `.post_score` title attr | Post score area |
| 6 | **permalink** | `#post_links li:first-child a` href | Post footer links |
| 7 | **external_link** | `#post_links a` href (reddit link) or `a.post_media_image` href | Various |
| 8 | **comment.author_is_op** | `a.comment_author.op` class presence | `.comment_data` |
| 9 | **comment.created** | `.comment_data a.created` title attr | `.comment_data` |
| 10 | **comment.permalink** | `.comment_data a.created` href attr → fragment `#p02m6q0` | `.comment_data` |
| 11 | **comment.id** | `.comment` div id attr → `p02m6q0` | Root comment div |
| 12 | **nested_comments** | `blockquote.replies > .comment` (recursive) | Inside parent `.comment` |
| 13 | **comment.depth** | Derived from nesting level in `blockquote.replies` hierarchy | Nested |

### MISSING — Nice-to-Have
| # | Field | Notes |
|---|-------|-------|
| — | edited indicator | Not visible in Redlib HTML |
| — | gold/awards | Redlib does not display awards |
| — | comment.mod_flair | `a.comment_author.moderator` class may indicate mod |

---

## 3. SUBREDDIT INFO

### Current tool: `get_subreddit_info` → fetches `/r/:sub/about/sidebar`
### Current parser `parseSubredditInfo()` extracts:
| Field | Source |
|-------|--------|
| title | `<title>` tag minus "Sidebar - " |
| description | First non-rules `<h3>` + `<p>` in `#wiki .md` |
| rules | `<h1>` elements after `<h3>Rules</h3>` |

### THE GAP: Subreddit info lives in TWO places

**Source A: `/r/:sub/about/sidebar`** — ONLY has wiki content (title, description, rules)

**Source B: Subreddit main page `/r/:sub/hot`** — `#subreddit` panel has RICH metadata:

| Field | CSS Selector | Present? |
|-------|-------------|----------|
| **icon_url** | `#sub_icon` src attr | ✅ On main page |
| **display_title** | `#sub_title` text | ✅ On main page |
| **name** (r/xxx) | `#sub_name` text | ✅ On main page |
| **description_short** | `#sub_description` text | ✅ On main page |
| **subscribers** | `#sub_details label:contains("Members") + div` title attr (exact: `"415510"`) + text (formatted: `"415.5k"`) | ✅ On main page |
| **active_users** | `#sub_details label:contains("Active") + div` title attr (exact: `"0"`) + text | ✅ On main page |
| **subscribe_url** | `#sub_subscription form` action attr | ✅ On main page |

### MISSING entirely (neither source):
| Field | Notes |
|-------|-------|
| created_date | Not in Redlib HTML — Reddit API has it, Redlib doesn't expose |
| moderators_list | Not in HTML (individual `post_author.moderator` classes appear on posts) |
| banner_image | Not in Redlib HTML |
| nsfw_flag | Not in Redlib HTML subreddit panel |

### RECOMMENDATION:
Add a NEW tool or extend `get_subreddit_info` to also scrape the main page's `#subreddit` panel, OR create a separate `get_subreddit_meta` tool. The sidebar page gives rules/description; the main page gives stats/icon.

---

## 4. USER PROFILES

### Currently extracted by `parseUserProfile()`:
| Field | CSS Selector |
|-------|-------------|
| username | `#user_title` text |
| karma | `#user_details label:contains("Karma") + div` text |
| cake_day | `#user_details label:contains("Created") + div` text |
| description | `#user_description` text |
| posts | `#posts > .post` (reuses post list logic) |
| comments | `#posts > .comment.user-comment` |

### MISSING:

| # | Missing Field | Location | Notes |
|---|--------------|----------|-------|
| 1 | **is_admin** | `a.post_author.admin` class on user's own posts | Indicates Reddit admin status |
| 2 | **post_karma / comment_karma split** | NOT in Redlib HTML | Redlib only shows single "Karma" label |
| 3 | **nsfw profile flag** | NOT in Redlib HTML | |
| 4 | **verified email** | NOT in Redlib HTML | |
| 5 | **moderator_of list** | NOT in Redlib HTML | |
| 6 | **profile_icon** | NOT in Redlib HTML user profile page | |

### User Comment fields (already reasonable but missing):
| Field | CSS Selector | Notes |
|-------|-------------|-------|
| comment_score_exact | `.comment_score` title attr | Already have score text |
| comment_permalink | `.comment_link` href | Already have linkHref |
| comment_id | From `.comment_link` href fragment | Extract `#os0o1vi` from href |

---

## 5. SEARCH RESULTS

### Current tools and their `type` params:

| Tool | URL | Type param |
|------|-----|-----------|
| `search_posts` | `/search?q=...&type=link` | `type=link` |
| `search_subreddits` | `/search?q=...&type=sr` | `type=sr` |
| `search_users` | `/search?q=...&type=user` | `type=user` |

### MISSING search capabilities:

| # | Feature | Redlib Support | URL Pattern | Tool Impact |
|---|---------|---------------|-------------|-------------|
| 1 | **type=comment** search | ✅ Redlib supports it | `/search?q=...&type=comment` | New tool `search_comments` |
| 2 | **flair filter** (global) | ✅ Via query syntax | `/search?q=flair_name%3A%22TEXT%22` | Add `flair` param to `search_posts` |
| 3 | **flair filter** (subreddit) | ✅ | `/r/:sub/search?q=flair_name%3A%22TEXT%22&restrict_sr=on` | Add `flair` param to `get_posts` |
| 4 | **author search** | ✅ Via query prefix | `/search?q=author%3AUSERNAME&type=link` | Add `author` param to `search_posts` |
| 5 | **selftext search** | ✅ Via query prefix | `/search?q=selftext%3ATERM&type=link` | Add `selftext` param to `search_posts` |
| 6 | **self:yes filter** | ✅ Via query | `/search?q=self%3Ayes+TERM&type=link` | Add `self_post_only` boolean param |
| 7 | **nsfw toggle** | ⚠️ Cookie-based | `show_nsfw` setting cookie (not query param) | Requires cookie management, not URL param |
| 8 | **safe search** | ✅ | `safe_search` param in some configs | Config-level, not per-request |
| 9 | **sort=comments** | ✅ Exposed | Already in `search_posts` `sort` enum | ✅ Done |
| 10 | **Time filter for all sorts** | ⚠️ Current code only passes `t` when sort=relevance/comments | Redlib accepts `t` for all sort modes | Fix in `search_posts` to always pass `t` |

### Search UI params exposed by Redlib:
The search form on search pages has: `q`, `sort`, `t` (timeframe). No `type` dropdown in UI (it's passed in URL only). No flair dropdown.

---

## 6. FLAIR SYSTEM — DEEP DIVE

### How Redlib renders flair in HTML:

```html
<a href="/r/MadeMeSmile/search?q=flair_name%3A%22:snoo_putback: Good Vibes :snoo_tongue:%22&restrict_sr=on"
   class="post_flair"
   style="color:black; background:#edeff1;"
   dir="ltr">
   <span class="emoji" style="background-image:url('/emoji/8228r6bhaezz_t5_3nqvj/snoo_putback');"></span>
   <span> Good Vibes </span>
   <span class="emoji" style="background-image:url('/emoji/pgm55sg3aezz_t5_3nqvj/snoo_tongue');"></span>
</a>
```

### Flair data to extract:
| Field | Selector | Example |
|-------|----------|---------|
| text | `a.post_flair span:not(.emoji)` text, joined | `"Good Vibes"` |
| text_color | `a.post_flair` style → `color` | `"black"` |
| bg_color | `a.post_flair` style → `background` | `"#edeff1"` |
| emoji_urls | `a.post_flair span.emoji` style → `background-image:url('...')` | Array of URLs |
| filter_url | `a.post_flair` href attr | URL-encoded flair search |

### Flair Filter URL Pattern:
```
/r/:subreddit/search?q=flair_name%3A%22<flair_text>%22&restrict_sr=on
```
This URL-encodes to: `flair_name%3A%22<text>%22` = `flair_name:"<text>"`

### Can you filter by flair globally? 
Try: `/search?q=flair_name%3A%22TEXT%22&type=link` — Redlib should pass this through to Reddit's search which supports flair filtering.

### Do posts have multiple flairs?
No. Reddit only supports one flair per post. Redlib shows exactly one `a.post_flair` per post.

---

## 7. SUMMARY: MVP ADDITIONS VS NICE-TO-HAVES

### MINIMUM VIABLE ADDITIONS (high impact, low effort)

| Priority | Addition | Affected Tools | Lines of Code |
|----------|----------|---------------|---------------|
| 🔴 P0 | **Flair extraction** (text, colors, filter URL) | `search_posts`, `get_posts`, `get_front_page`, `get_user`, `get_post` | ~15 lines in `parsePostList` |
| 🔴 P0 | **Created timestamp** (UTC + relative) | All post-listing tools + `get_post` | ~3 lines per parser |
| 🔴 P0 | **Upvote ratio** on post detail | `get_post` | ~3 lines in `parsePostDetails` |
| 🔴 P0 | **Subreddit stats** (members, active, icon, description) | New `get_subreddit_info` source or new tool | ~30 lines new parser |
| 🟡 P1 | **Post type** (link/self/image/video/gallery) | All post-listing tools | ~15 lines in `parsePostList` |
| 🟡 P1 | **Stickied indicator** | All post-listing tools | ~2 lines |
| 🟡 P1 | **Author flair** (moderator/admin/OP) | All comment/post tools | ~5 lines |
| 🟡 P1 | **Comment nesting + depth** | `get_post` | ~20 lines recursive parse |
| 🟡 P1 | **Comment permalink + ID** | `get_post` | ~5 lines |
| 🟡 P1 | **Score exact** (from title attr) | All tools with scores | ~5 lines |

### NICE-TO-HAVE (lower impact or more work)

| Priority | Addition | Notes |
|----------|----------|-------|
| 🟢 P2 | `search_comments` tool (type=comment) | New tool ~30 lines |
| 🟢 P2 | `flair` param on `search_posts` / `get_posts` | Add to query builder |
| 🟢 P2 | `author` param on `search_posts` | Query prefix |
| 🟢 P2 | `selftext` / `self_post_only` params on search | Query modifiers |
| 🟢 P2 | `thumbnail_url` + `external_url` extraction | ~8 lines |
| 🟢 P2 | `edited` indicator (if Redlib adds it) | Monitor Redlib updates |
| ⚪ P3 | NSFW tag on posts | Redlib may expose as CSS class |
| ⚪ P3 | Spoiler tag | Redlib may expose as CSS class |
| ⚪ P3 | Post karma / comment karma split | Redlib doesn't expose split |
| ⚪ P3 | Moderator list for subreddits | Redlib doesn't expose |
| ⚪ P3 | Banner image for subreddits | Redlib doesn't expose |
| ⚪ P3 | Subreddit created date | Redlib doesn't expose |
| ⚪ P3 | User NSFW flag, verified email, moderator-of | Redlib doesn't expose |
| ⚪ P3 | Gold/awards | Redlib doesn't display |

---

## 8. PARSER BUG / DESIGN NOTE

The current `parsePostList` uses `$titleLink = $el.find('.post_title a').not('.post_flair').first()` to skip flair — but this also skips the flair data entirely. Fix: capture flair BEFORE filtering it out, then extract both.

### Current:
```typescript
const $titleLink = $el.find('.post_title a').not('.post_flair').first();
```

### Recommended:
```typescript
// Extract flair first
const $flair = $el.find('.post_title a.post_flair').first();
const flair = $flair.length ? {
  text: $flair.find('span:not(.emoji)').map((_,s) => $(s).text()).get().join(' ').trim(),
  text_color: $flair.attr('style')?.match(/color:\s*([^;]+)/)?.[1],
  bg_color: $flair.attr('style')?.match(/background:\s*([^;]+)/)?.[1],
  filter_url: $flair.attr('href'),
} : undefined;

// Then get title link (the non-flair <a>)
const $titleLink = $el.find('.post_title a').not('.post_flair').first();
```
