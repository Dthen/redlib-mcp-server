# Redlib MCP Server

An MCP server that puts a private [Redlib](https://github.com/redlib-org/redlib) instance behind ten tools: search posts, subreddits, users and comments; read front pages, subreddit info and wikis, user profiles, and posts with their comments. No Reddit API key is needed — every request goes to your Redlib instance, which does the fetching.

Fork of [Devthatdoes/redlib-mcp-server](https://github.com/Devthatdoes/redlib-mcp-server).

## Requirements

- **Node.js `>=20.18.1`.** That is the `engines` floor, required by `cheerio` 1.2.0. Verified on Node 22.23.4; the 20.18.x minimum itself was not exercised.
- A reachable Redlib instance.
- An MCP client (Claude Desktop, Cursor, VS Code, Codex, or any MCP-compatible client).

## Install

### From source

```bash
npm install
npm run build
npm start
```

`npm start` runs the compiled `dist/index.js`.

### Packed tarball (runtime only)

`npm pack` in the source checkout builds `dist/` (via `prepack`) and writes a runtime tarball containing compiled `dist/` plus `package.json`, `README.md` and `LICENSE`. Installing it needs neither the source tree nor `devDependencies`.

```bash
npm pack                                      # → redlib-mcp-server-2.0.0.tgz
npm install ./redlib-mcp-server-2.0.0.tgz     # in your own project
./node_modules/.bin/redlib-mcp-server
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REDLIB_URL` | `http://localhost:8080` | Base URL of your Redlib instance. A path prefix is preserved and every outbound request stays inside this origin and prefix. |
| `REDLIB_PUBLIC_URL` | `https://www.reddit.com` | Public base used to build permalinks in tool output. It is never fetched. |

Client entry (paths adjusted):

```json
{
  "mcpServers": {
    "redlib": {
      "command": "node",
      "args": ["/path/to/node_modules/redlib-mcp-server/dist/index.js"],
      "env": { "REDLIB_URL": "http://127.0.0.1:8080" }
    }
  }
}
```

## Protocol

stdio transport, MCP JSON-RPC 2.0. This build negotiates protocol version `2025-11-25`.

## Tools

| Tool | Returns | Required | Options |
|------|---------|----------|---------|
| `search_posts` | Post listings | `query` | `subreddit`, `sort`, `t`, `limit`, `flair`, `author`, `selftext`, `self_post_only` |
| `get_posts` | Post listings for a subreddit | `subreddit` | `sort`, `t`, `limit` |
| `get_post` | One post with its comments | `postId` | `subreddit` hint, `comment_sort`, `comment_limit` |
| `search_subreddits` | Subreddit cards | `query` | `limit` |
| `search_users` | User cards | `query` | `limit` |
| `search_comments` | Comment results | `query` | `subreddit`, `sort` (`relevance`/`top`/`new`), `t`, `limit` |
| `get_subreddit_info` | Description, rules, member counts | `subreddit` | — |
| `get_user` | Profile plus a listing | `username` | `listing`, `sort`, `t`, `limit` |
| `get_front_page` | Post listings from `popular` or `all` | — | `feed`, `sort`, `t`, `limit` |
| `get_wiki_page` | Wiki page text | `subreddit` | `page` (default `index`, may contain `/`) |

`postId` accepts a base36 post ID, `t3_`-prefixed ID, `/comments/<id>`, a scoped path (`r/<sub>/comments/<id>`, `user/<name>/comments/<id>`), a Reddit post or share URL, or a bare share reference (`s/<token>`) together with the `subreddit` hint. Comment URLs resolve to their parent post. URL inputs are only accepted from Reddit hosts, `redd.it`, and the configured `REDLIB_URL`/`REDLIB_PUBLIC_URL` origins; anything else is rejected before any request.

## Output, limits and errors

- Each result is one `text` content block containing JSON. Field sets differ per tool; optional fields are omitted rather than guessed.
- `limit` (default 25) and `comment_limit` (default 10) are nonnegative integers. `0` returns an empty collection and still performs the normal request. They cap items taken from the single upstream page that was fetched — there is no pagination, and the server does not fetch further pages or invent global totals. `get_user` limits its posts and comments independently.
- `get_post.commentCount` counts every comment element on the fetched page, nested replies included, before any limit is applied; `comment_limit` slices top-level comments and keeps their replies. It is therefore not the length of the returned `comments` array.
- Per operation: 30 s deadline across request and body, 5 MiB decompressed body cap, at most 5 redirect hops, redirects only within the configured origin and prefix. Oversize and timeout failures are errors, not truncated results.
- Upstream error pages produce `isError: true` and a message starting `Error searching …` (`search_posts`, `search_subreddits`, `search_users`, `search_comments`) or `Error fetching …` (the other six tools). A genuinely empty listing, wiki body or user collection is a success. A `get_post` ID that 404s on a subreddit path retries once under `/user/<hint>/comments/<id>`; other statuses do not fall back.

## License

MIT — see `LICENSE`.

## Acknowledgments

- [Redlib](https://github.com/redlib-org/redlib) — the private Reddit front-end this server reads.
- [Model Context Protocol](https://modelcontextprotocol.io/) — the protocol and SDK.
- [Cheerio](https://github.com/cheeriojs/cheerio) — HTML parsing.
- [Devthatdoes](https://github.com/Devthatdoes/redlib-mcp-server) — the original MCP server.
