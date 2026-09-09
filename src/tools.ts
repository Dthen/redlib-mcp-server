import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fetch from "node-fetch";
import { parsePostList, parsePostDetails, parseSubredditSearch, parseUserSearch, parseSubredditInfo, parseSubredditMeta, parseUserProfile, parseWikiPage } from "./parsers.js";

const REDLIB_BASE_URL = process.env.REDLIB_URL || "http://localhost:8080";
// Public base for permalinks / navigation links (the private instance URLs are useless to consumers)
const REDLIB_PUBLIC_URL = (process.env.REDLIB_PUBLIC_URL || "https://www.reddit.com").replace(/\/+$/, "");

/**
 * Registers all Redlib MCP tools on the given server instance.
 */
export function registerTools(server: McpServer): void {
  // Tool 1: Search Reddit posts via Redlib
  server.tool(
    "search_posts",
    "Search Reddit posts using your private Redlib instance. Supports sort order, time filter, and advanced filters (flair, author, selftext, self_post_only). Returns post IDs for follow-up with get_post.",
    {
      query: z.string().describe("Search query"),
      subreddit: z.string().optional().describe("Limit search to a specific subreddit (optional)"),
      sort: z.enum(["relevance", "hot", "top", "new", "comments"]).optional().default("relevance").describe("Sort order (default: relevance)"),
      t: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Time filter (applies to all sort modes)"),
      limit: z.number().optional().default(25).describe("Maximum number of results to return (default: 25)"),
      flair: z.string().optional().describe("Filter by flair name (e.g. 'discussion')"),
      author: z.string().optional().describe("Filter by author username (e.g. 'spez')"),
      selftext: z.string().optional().describe("Search within post body text"),
      self_post_only: z.boolean().optional().describe("Only return self/text posts (no links)"),
    },
    async ({ query, subreddit, sort, t, limit, flair, author, selftext, self_post_only }) => {
      try {
        const params = new URLSearchParams();

        // Build query with advanced search operators
        let q = query;
        if (flair) q = `flair_name:"${flair}" ${q}`;
        if (author) q = `author:${author} ${q}`;
        if (selftext) q = `selftext:${selftext} ${q}`;
        if (self_post_only) q = `self:yes ${q}`;
        params.set("q", q.trim());

        // For global search, include type=link to get post results
        if (!subreddit) {
          params.set("type", "link");
        } else {
          // Restrict search to the specified subreddit
          params.set("restrict_sr", "on");
        }
        if (sort) params.set("sort", sort);
        if (t) params.set("t", t);
        if (limit) params.set("limit", String(limit));

        const url = subreddit
          ? `${REDLIB_BASE_URL}/r/${subreddit}/search?${params.toString()}`
          : `${REDLIB_BASE_URL}/search?${params.toString()}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const results = parsePostList(html, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        // Apply client-side limit since Redlib may ignore the query param
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              sort: sort || "relevance",
              ...(t ? { timeFilter: t } : {}),
              resultCount: limited.length,
              posts: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching Reddit: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 2: Get posts from a subreddit with sort and time filter
  server.tool(
    "get_posts",
    "Get posts from a specific subreddit. Supports sort modes (hot, new, top, rising, controversial) and time filters for top/controversial.",
    {
      subreddit: z.string().describe("Subreddit name (without r/)"),
      sort: z.enum(["hot", "new", "top", "rising", "controversial"]).optional().default("hot").describe("Sort mode (default: hot)"),
      t: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Time filter (only applies when sort is top or controversial)"),
      limit: z.number().optional().default(25).describe("Maximum number of posts to return (default: 25)"),
    },
    async ({ subreddit, sort, t, limit }) => {
      try {
        const params = new URLSearchParams();
        // t (time filter) only applies to top and controversial
        if (t && (sort === "top" || sort === "controversial")) {
          params.set("t", t);
        }

        const url = `${REDLIB_BASE_URL}/r/${subreddit}/${sort}${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const results = parsePostList(html, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        // Apply client-side limit since Redlib may ignore the query param
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              subreddit,
              sort: sort || "hot",
              ...(t ? { timeFilter: t } : {}),
              resultCount: limited.length,
              posts: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching posts: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 3: Get specific post with comments
  server.tool(
    "get_post",
    "Get a specific Reddit post and its comments. Use post ID from search or hot post results. `subreddit` may also be a username: profile posts resolve via a /user/ fallback when the /r/ path 404s.",
    {
      subreddit: z.string().describe("Subreddit name, or username for user-profile posts"),
      postId: z.string().describe("Reddit post ID (from search/hot results)"),
      comment_sort: z.enum(["confidence", "top", "new", "controversial", "old"]).optional().describe("Comment sort order (optional, Redlib default is confidence)"),
      comment_limit: z.number().optional().default(10).describe("Maximum number of comments to return (default: 10)"),
    },
    async ({ subreddit, postId, comment_sort, comment_limit }) => {
      try {
        const params = new URLSearchParams();
        if (comment_sort) params.set("sort", comment_sort);
        const query = params.toString() ? `?${params.toString()}` : '';

        const primaryUrl = `${REDLIB_BASE_URL}/r/${subreddit}/comments/${postId}${query}`;
        let response = await fetch(primaryUrl);
        if (response.status === 404) {
          // User-profile posts live under /user/<name>/comments/<id> (not /r/<name>/...),
          // so fall back to the /user/ path when the /r/ path 404s.
          const fallbackUrl = `${REDLIB_BASE_URL}/user/${subreddit}/comments/${postId}${query}`;
          response = await fetch(fallbackUrl);
        }
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const postData = parsePostDetails(html, comment_limit, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(postData, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching post: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 4: Search subreddits
  server.tool(
    "search_subreddits",
    "Search for subreddits on Reddit via Redlib. Returns subreddit names, subscriber counts, and descriptions.",
    {
      query: z.string().describe("Search query for subreddits"),
      limit: z.number().optional().default(25).describe("Maximum number of results to return (default: 25)"),
    },
    async ({ query, limit }) => {
      try {
        const params = new URLSearchParams();
        params.set("q", query);
        params.set("type", "sr");

        const url = `${REDLIB_BASE_URL}/search?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const results = parseSubredditSearch(html);

        // Apply client-side limit
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              resultCount: limited.length,
              subreddits: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching subreddits: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 5: Search users
  server.tool(
    "search_users",
    "Search for Reddit users via Redlib. Returns usernames and optional profile descriptions.",
    {
      query: z.string().describe("Search query for users"),
      limit: z.number().optional().default(25).describe("Maximum number of results to return (default: 25)"),
    },
    async ({ query, limit }) => {
      try {
        const params = new URLSearchParams();
        params.set("q", query);
        params.set("type", "user");

        const url = `${REDLIB_BASE_URL}/search?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const results = parseUserSearch(html);

        // Apply client-side limit
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              resultCount: limited.length,
              users: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching users: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 6: Get subreddit info from sidebar
  server.tool(
    "get_subreddit_info",
    "Get detailed information about a subreddit (description, rules, etc.) from the Redlib sidebar page.",
    {
      subreddit: z.string().describe("Subreddit name (without r/)"),
    },
    async ({ subreddit }) => {
      try {
        // Fetch sidebar (wiki content: description, rules) and main page (stats, icon)
        const [sidebarRes, mainRes] = await Promise.all([
          fetch(`${REDLIB_BASE_URL}/r/${subreddit}/about/sidebar`),
          fetch(`${REDLIB_BASE_URL}/r/${subreddit}/hot`),
        ]);
        if (!sidebarRes.ok) throw new Error(`Redlib sidebar returned ${sidebarRes.status}: ${sidebarRes.statusText}`);
        if (!mainRes.ok) throw new Error(`Redlib main page returned ${mainRes.status}: ${mainRes.statusText}`);

        const [sidebarHtml, mainHtml] = await Promise.all([
          sidebarRes.text(),
          mainRes.text(),
        ]);

        const sidebarInfo = parseSubredditInfo(sidebarHtml);
        const meta = parseSubredditMeta(mainHtml, REDLIB_BASE_URL);

        // Merge: main-page meta first, sidebar fields fill in / override
        const merged = {
          ...meta,
          ...sidebarInfo,
          // Prefer sidebar description (longer wiki version) if present, keep short from meta
          ...(sidebarInfo.description ? { description: sidebarInfo.description } : {}),
          ...(meta.description_short ? { description_short: meta.description_short } : {}),
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(merged, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching subreddit info: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 7: Get user profile
  server.tool(
    "get_user",
    "Get a Reddit user's profile information, posts, and comments via Redlib. Returns profile details (karma, cake day, description) and content listings.",
    {
      username: z.string().describe("Reddit username (without u/)"),
      listing: z.enum(["overview", "submitted", "comments"]).optional().default("overview").describe("Content listing type (default: overview)"),
      sort: z.enum(["hot", "new", "top", "controversial"]).optional().describe("Sort order (optional)"),
      t: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Time filter (only applies when sort is top or controversial)"),
      limit: z.number().optional().default(25).describe("Maximum number of posts/comments to return (default: 25)"),
    },
    async ({ username, listing, sort, t, limit }) => {
      try {
        const params = new URLSearchParams();
        if (sort) params.set("sort", sort);
        if (t) params.set("t", t);

        const listingPath = listing === "overview" ? "" : `/${listing}`;
        const url = `${REDLIB_BASE_URL}/user/${username}${listingPath}${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const profile = parseUserProfile(html, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        // Apply client-side limit
        const limitedPosts = profile.posts.slice(0, limit);
        const limitedComments = profile.comments.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              username: profile.username,
              ...(profile.karma ? { karma: profile.karma } : {}),
              ...(profile.cake_day ? { cake_day: profile.cake_day } : {}),
              ...(profile.description ? { description: profile.description } : {}),
              listing: listing || "overview",
              ...(sort ? { sort } : {}),
              ...(t ? { timeFilter: t } : {}),
              postCount: limitedPosts.length,
              commentCount: limitedComments.length,
              posts: limitedPosts,
              comments: limitedComments,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching user profile: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 8: Get Reddit front page (popular or r/all)
  server.tool(
    "get_front_page",
    "Get posts from the Reddit front page — either the popular feed or r/all. Supports sort modes (hot, new, top, rising, controversial) and time filters for top/controversial.",
    {
      feed: z.enum(["popular", "all"]).optional().default("popular").describe("Feed type: popular (default Reddit front page) or all (r/all)"),
      sort: z.enum(["hot", "new", "top", "rising", "controversial"]).optional().default("hot").describe("Sort mode (default: hot)"),
      t: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Time filter (only applies when sort is top or controversial)"),
      limit: z.number().optional().default(25).describe("Maximum number of posts to return (default: 25)"),
    },
    async ({ feed, sort, t, limit }) => {
      try {
        const params = new URLSearchParams();
        if (t && (sort === "top" || sort === "controversial")) {
          params.set("t", t);
        }

        let url: string;
        if (feed === "all") {
          // r/all: /r/all for hot, /r/all/<sort> for other sorts
          url = sort === "hot"
            ? `${REDLIB_BASE_URL}/r/all`
            : `${REDLIB_BASE_URL}/r/all/${sort}`;
        } else {
          // popular: / for hot, /<sort> for other sorts
          url = sort === "hot"
            ? `${REDLIB_BASE_URL}/`
            : `${REDLIB_BASE_URL}/${sort}`;
        }

        if (params.toString()) {
          url += `?${params.toString()}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const results = parsePostList(html, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        // Apply client-side limit
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              feed: feed || "popular",
              sort: sort || "hot",
              ...(t ? { timeFilter: t } : {}),
              resultCount: limited.length,
              posts: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching front page: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 10: Search comments
  server.tool(
    "search_comments",
    "Search Reddit comments via Redlib. Returns comment text, authors, scores, and links to the parent posts.",
    {
      query: z.string().describe("Search query for comments"),
      subreddit: z.string().optional().describe("Limit search to a specific subreddit (optional)"),
      sort: z.enum(["relevance", "hot", "top", "new", "comments"]).optional().default("relevance").describe("Sort order (default: relevance)"),
      t: z.enum(["hour", "day", "week", "month", "year", "all"]).optional().describe("Time filter (applies to all sort modes)"),
      limit: z.number().optional().default(25).describe("Maximum number of results to return (default: 25)"),
    },
    async ({ query, subreddit, sort, t, limit }) => {
      try {
        const params = new URLSearchParams();
        params.set("q", query);
        params.set("type", "comment");
        if (subreddit) params.set("restrict_sr", "on");
        if (sort) params.set("sort", sort);
        if (t) params.set("t", t);
        if (limit) params.set("limit", String(limit));

        const url = subreddit
          ? `${REDLIB_BASE_URL}/r/${subreddit}/search?${params.toString()}`
          : `${REDLIB_BASE_URL}/search?${params.toString()}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        // Redlib renders comment search results as .post elements on search pages
        const results = parsePostList(html, REDLIB_BASE_URL, REDLIB_PUBLIC_URL);

        // Apply client-side limit
        const limited = results.slice(0, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              sort: sort || "relevance",
              ...(t ? { timeFilter: t } : {}),
              resultCount: limited.length,
              comments: limited,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error searching comments: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool 9: Get subreddit wiki page
  server.tool(
    "get_wiki_page",
    "Get the contents of a subreddit's wiki page via Redlib. Returns the page title and wiki content.",
    {
      subreddit: z.string().describe("Subreddit name (without r/)"),
      page: z.string().optional().default("index").describe("Wiki page name (default: index)"),
    },
    async ({ subreddit, page }) => {
      try {
        const url = `${REDLIB_BASE_URL}/r/${subreddit}/wiki/${page}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Redlib returned ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const wikiPage = parseWikiPage(html);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(wikiPage, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error fetching wiki page: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
