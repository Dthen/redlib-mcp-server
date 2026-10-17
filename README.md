# Redlib MCP Server

A **Model Context Protocol (MCP) server** that enables AI agents to interact with Reddit through your private **Redlib** instance. No Reddit API keys required — just a running Redlib instance.

This is a fork of [Devthatdoes/redlib-mcp-server](https://github.com/Devthatdoes/redlib-mcp-server), extended from 3 to 10 tools with full coverage of Redlib's capabilities.

## Features

- **Privacy-First** — Uses your self-hosted Redlib, no tracking or API keys
- **10 Tools** — Search posts, subreddits, users, comments; browse front page, user profiles, wiki pages; fetch posts with comments
- **Structured Output** — Returns clean JSON instead of raw HTML
- **Post-Reference Resolution** — `get_post` accepts bare IDs, scoped paths, full Reddit URLs, and share references with bounded, Redlib-only fetching

## Prerequisites

1. **Redlib Instance** — A running Redlib instance (default: `http://localhost:8080`)
   - [Redlib GitHub](https://github.com/redlib-org/redlib)
2. **MCP Client** — Claude Desktop, Cursor, VS Code, Codex, or any MCP-compatible client

## Quick Start

### Local Development

```bash
git clone https://github.com/Dthen/redlib-mcp-server.git
cd redlib-mcp-server
npm install
npm run build
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REDLIB_URL` | `http://localhost:8080` | URL of your Redlib instance (every outbound request targets this origin) |
| `REDLIB_PUBLIC_URL` | `https://www.reddit.com` | Public base URL for permalinks and flair filter links in tool output |

## Tools

### `search_posts`
Search Reddit posts. Supports sort order, time filter, and subreddit scoping.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `query` | yes | — | Search query string |
| `subreddit` | no | — | Limit search to a specific subreddit |
| `sort` | no | `relevance` | `relevance`, `hot`, `top`, `new`, `comments` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (applies to all sort modes) |
| `limit` | no | 25 | Maximum results |
| `flair` | no | — | Filter by flair name (e.g. 'discussion') |
| `author` | no | — | Filter by author username (e.g. 'spez') |
| `selftext` | no | — | Search within post body text |
| `self_post_only` | no | — | Only return self/text posts (no links) |

### `get_posts`
Get posts from a subreddit. Supports all sort modes and time filters.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `subreddit` | yes | — | Subreddit name (without r/) |
| `sort` | no | `hot` | `hot`, `new`, `top`, `rising`, `controversial` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (only with `top` or `controversial`) |
| `limit` | no | 25 | Maximum posts |

### `get_post`
Get a post and its comments. `postId` accepts a Reddit post ID (from search or hot results), a full Reddit URL, or a share reference (`s/<token>` or `r/<sub>/s/<token>`). The optional `subreddit` hint scopes bare IDs and bare share fragments (`s/<token>`) to a subreddit or user profile. Full scoped paths (`r/<sub>/comments/<id>`) and full scoped URLs do NOT use the hint.

#### Accepted `postId` forms

| Form | Example | Needs `subreddit`? | Resolution |
|------|---------|---------------------|------------|
| Bare ASCII base36 ID | `1x7hpcl` | Optional | `/r/<hint>/comments/<id>` → 404 fallback `/user/<hint>/comments/<id>` |
| `t3_`-prefixed fullname | `t3_1x7hpcl` | Optional | Same as bare ID (prefix stripped internally) |
| Scoped path | `r/webscraping/comments/1x7hpcl` | No | Direct: `/r/webscraping/comments/1x7hpcl` |
| `/comments/<id>` | `/comments/1x7hpcl` | No | Direct: `/comments/1x7hpcl` |
| Reddit permalink URL | `https://www.reddit.com/r/webscraping/comments/1x7hpcl/` | No | Host must be in allow-list; path extracted |
| Full share URL | `https://www.reddit.com/r/webscraping/s/yf4R7bbaHP` | No | `/r/webscraping/s/<token>` → 302 → canonical |
| Bare share fragment | `s/yf4R7bbaHP` | **Required** | `/r/<hint>/s/<token>` → 302 → canonical |
| Scoped share path | `r/webscraping/s/yf4R7bbaHP` | No | `/r/webscraping/s/<token>` → 302 → canonical |
| Short link | `https://redd.it/1x7hpcl` | No | `/comments/1x7hpcl` (shortener never fetched) |

#### Subreddit hint policy

- **Only** bare single-token IDs and bare `s/<token>` fragments use the hint.
- Scoped paths (`r/<name>/...`, `/comments/<id>`), full URLs, and scoped shares are authoritative — the hint is ignored.
- A non-string hint is treated as absent (never coerced to `"null"`).
- The hint must be a valid `[A-Za-z0-9_-]+` segment.

#### Profile fallback semantics

- **Bare ID + hint**: Primary `/r/<hint>/comments/<id>`. On HTTP 404 only (never on 403/429/empty-200/error), falls back to `/user/<hint>/comments/<id>`.
- **Bare share fragment + hint**: No fallback (shares under `user/` are not part of the contract).
- **Scoped paths / full URLs / explicit `/user/` routes**: No fallback.
- **Explicit user URLs** (`https://www.reddit.com/user/<name>/comments/<id>`) do NOT trigger profile fallback.

#### Supported origins

Only these hosts are accepted in URL form (exact match, no wildcards):

- `reddit.com`, `www.reddit.com`, `old.reddit.com`, `new.reddit.com`, `np.reddit.com`, `m.reddit.com`, `sh.reddit.com`
- `redd.it`, `www.redd.it` (short-link hosts; the shortener is never fetched)
- The configured `REDLIB_URL` and `REDLIB_PUBLIC_URL` origins (including any base-path prefix)

All other hosts are rejected before any network I/O. Unconfigured Redlib hostnames need a supported relative path or intentional admin config.

#### URL parameter handling

- **Fragment and tracking parameters are stripped** from all URL inputs and never forwarded.
- Only a recognised `sort` parameter is preserved: `confidence`, `top`, `new`, `controversial`, `old`.
- An explicit `comment_sort` tool argument always wins over a URL `sort` parameter.

#### Comment sort and limit

- `comment_sort`: Optional. `confidence`, `top`, `new`, `controversial`, `old`. Defaults to Redlib's native sort (confidence). Overrides URL `sort` when both present.
- `comment_limit`: Maximum top-level comments returned (default: 10). Replies under each top-level comment are unchanged.

#### Fetch budget and failure modes

- **Timeout**: 30 seconds total per operation (covers all redirects, the 404 fallback, and body consumption).
- **Redirects**: At most 5 hops per operation (the 404 profile fallback is not itself a redirect hop).
- **Body cap**: 5 MiB decompressed. Oversize bodies fail with a typed error (not truncated).
- **Redirect handling**: `redirect: 'manual'`. Only 301/302/303/307/308 are followed. Redirect `Location` is re-parsed through the same pure reference grammar; external hosts, unsafe routes, userinfo, non-HTTP schemes, https→http downgrades, and loops are rejected.
- **eCAPTCHA**: Every outbound request targets the configured `REDLIB_URL` origin and its base-path prefix. Reddit URLs and `REDLIB_PUBLIC_URL` are reference origins — they are recognised and remapped, never fetched.

#### Validity guard

A non-empty `title` and a valid ASCII base36 post ID (matching the expected ID, case-insensitive) are required. Legitimate posts with deleted authors, empty bodies, zero comments, hidden scores, or images-only pages are valid. Invalid pages produce `Error fetching post: ...` with `isError: true`.

#### Error responses

All tool errors return `isError: true` with a human-readable message prefixed by `Error fetching post:`. Invalid input or unsafe `Location` values are rejected before any I/O.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `postId` | yes | — | Reddit post ID, permalink URL, or share reference (`s/<token>` or `r/<sub>/s/<token>`) |
| `subreddit` | no | — | Optional scope hint for bare IDs and share fragments (subreddit or username). Scoped paths and URLs ignore it. |
| `comment_sort` | no | — | `confidence`, `top`, `new`, `controversial`, `old` |
| `comment_limit` | no | 10 | Maximum comments to return |

### `search_subreddits`
Search for subreddits. Returns names, subscriber counts, and descriptions.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `query` | yes | — | Search query for subreddits |
| `limit` | no | 25 | Maximum results |

### `search_users`
Search for Reddit users. Returns usernames and optional profile descriptions.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `query` | yes | — | Search query for users |
| `limit` | no | 25 | Maximum results |

### `search_comments`
Search Reddit comments. Returns comment text, authors, scores, and links to parent posts.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `query` | yes | — | Search query for comments |
| `subreddit` | no | — | Limit search to a specific subreddit |
| `sort` | no | `relevance` | `relevance`, `hot`, `top`, `new`, `comments` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` |
| `limit` | no | 25 | Maximum results |

### `get_subreddit_info`
Get detailed subreddit info (description, rules, subscriber count, etc.).

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `subreddit` | yes | — | Subreddit name (without r/) |

### `get_user`
Get a user's profile, posts, and comments. Supports listing type, sort, and time filters.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `username` | yes | — | Reddit username (without u/) |
| `listing` | no | `overview` | `overview`, `submitted`, `comments` |
| `sort` | no | — | `hot`, `new`, `top`, `controversial` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (only with `top` or `controversial`) |
| `limit` | no | 25 | Maximum posts/comments |

### `get_front_page`
Get posts from the front page (popular or r/all). Supports sort modes and time filters.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `feed` | no | `popular` | `popular` or `all` (r/all) |
| `sort` | no | `hot` | `hot`, `new`, `top`, `rising`, `controversial` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (only with `top` or `controversial`) |
| `limit` | no | 25 | Maximum posts |

### `get_wiki_page`
Get a subreddit's wiki page.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `subreddit` | yes | — | Subreddit name (without r/) |
| `page` | no | `index` | Wiki page name |

## Integration

### Hermes Agent

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  redlib:
    command: node
    args:
      - /path/to/redlib-mcp-server/dist/index.js
    env:
      REDLIB_URL: http://127.0.0.1:8080
    enabled: true
```

### Other MCP Clients

All MCP clients use the same command. Adjust `REDLIB_URL` if your Redlib runs on a different port.

```json
{
  "mcpServers": {
    "redlib": {
      "command": "node",
      "args": ["/path/to/redlib-mcp-server/dist/index.js"],
      "env": { "REDLIB_URL": "http://localhost:8080" }
    }
  }
}
```

- **Claude Desktop**: Edit `~/.config/claude/claude_desktop_config.json` (Linux/macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart.
- **Cursor**: Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project).
- **VS Code**: Create `.vscode/mcp.json` (workspace) or use Command Palette → "MCP: Open User Configuration".
- **Codex**: Edit `~/.codex/config.toml` — `[mcp_servers.redlib]` with the command/args above.

## Development

### Project Structure

```
redlib-mcp-server/
├── src/
│   ├── index.ts          # Server entry point (stdio transport)
│   ├── parsers.ts        # HTML parsing with Cheerio
│   ├── post-reference.ts # Pure post-reference grammar (no I/O)
│   ├── post-fetch.ts     # Bounded, Redlib-only fetch helper
│   └── tools.ts          # Tool registration and handlers
├── tests/
│   ├── fixtures/         # HTML fixtures for parser tests
│   ├── parsers.test.ts   # Parser unit tests
│   ├── post-reference.test.ts
│   ├── post-fetch.test.ts
│   ├── post-fetch-http.test.ts
│   ├── tools.test.ts
│   ├── parser-error.test.ts
│   ├── integration.test.ts
│   ├── qa.test.ts
│   └── mcp-smoke.ts      # Standalone stdio JSON-RPC smoke harness
├── package.json
├── tsconfig.json
├── jest.config.ts
├── LICENSE
└── README.md
```

### Build & Test

```bash
npm install
npm run build
npm test
```

**`npm test`** is hermetic: it runs all unit test suites via Jest with no network access. The standalone live harness (`tests/mcp-smoke.ts`) and integration/QA suites are excluded from the default Jest run.

### Smoke Harness

The smoke harness (`tests/mcp-smoke.ts`) exercises the compiled MCP server over real stdio JSON-RPC 2.0. It does NOT require internet access in default (mock) mode.

#### Commands

```bash
# Default mode — hermetic mock (local fixture server, no internet)
./node_modules/.bin/tsx tests/mcp-smoke.ts
# or equivalently:
./node_modules/.bin/tsx tests/mcp-smoke.ts --mock

# Live mode — requires a reachable Redlib instance
REDLIB_URL=http://127.0.0.1:8080 ./node_modules/.bin/tsx tests/mcp-smoke.ts --live
```

- **Default (mock)**: Starts a local HTTP fixture server on `127.0.0.1`, spawns the compiled server with a scoped `REDLIB_URL`, and exercises every supported post-reference form through the real MCP protocol boundary (initialize, notifications/initialized, tools/list, tools/call). All traffic stays on loopback. 10 test cases.
- **Explicit live** (`--live`): Requires a reachable Redlib at `REDLIB_URL` (default `http://127.0.0.1:8080`). A bounded 3s upstream probe runs before any child spawn; if unreachable, live cases are recorded as `BLOCKED` (never a fake pass). Otherwise exactly 3 bounded `get_post` calls are made (legacy ID with comment_sort=new + comment_limit=1, full share URL, bare share fragment). 8 test cases.

#### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All cases passed |
| 1 | At least one case failed (or harness error) |
| 2 | Usage error (unknown or conflicting args) — raised before any spawn or network activity |
| 3 | Overall deadline exceeded (awaited cleanup, then exit) |
| 4 | Live upstream blocked, no failures |

No global installs, Docker, or new package managers are required — the harness runs via the project's existing `tsx` dev dependency.

## License

MIT

## Acknowledgments

- [Redlib](https://github.com/redlib-org/redlib) — The private Reddit front-end
- [Model Context Protocol](https://modelcontextprotocol.io/) — The protocol
- [Cheerio](https://github.com/cheeriojs/cheerio) — HTML parsing
- [Devthatdoes](https://github.com/Devthatdoes/redlib-mcp-server) — Original MCP server
