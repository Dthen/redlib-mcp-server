# Redlib MCP Server

A **Model Context Protocol (MCP) server** that enables AI agents to interact with Reddit through your private **Redlib** instance. No Reddit API keys required — just a running Redlib instance.

This is a fork of [Devthatdoes/redlib-mcp-server](https://github.com/Devthatdoes/redlib-mcp-server), extended from 3 to 10 tools with full coverage of Redlib's capabilities.

## Features

- **Privacy-First** — Uses your self-hosted Redlib, no tracking or API keys
- **10 Tools** — Search posts, subreddits, users, comments; browse front page, user profiles, wiki pages; fetch posts with comments
- **Structured Output** — Returns clean JSON instead of raw HTML

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
| `REDLIB_URL` | `http://localhost:8080` | URL of your Redlib instance |
| `REDLIB_PUBLIC_URL` | `https://www.reddit.com` | Public base URL for permalinks and flair filter links |

## Tools

### `search_posts`
Search Reddit posts. Supports sort order, time filter, and subreddit scoping.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `query` | yes | — | Search query string |
| `subreddit` | no | — | Limit search to a specific subreddit |
| `sort` | no | `relevance` | `relevance`, `hot`, `top`, `new`, `comments` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (only with `relevance` or `comments`) |
| `limit` | no | 25 | Maximum results |

### `get_posts`
Get posts from a subreddit. Supports all sort modes and time filters.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `subreddit` | yes | — | Subreddit name (without r/) |
| `sort` | no | `hot` | `hot`, `new`, `top`, `rising`, `controversial` |
| `t` | no | — | `hour`, `day`, `week`, `month`, `year`, `all` (only with `top` or `controversial`) |
| `limit` | no | 25 | Maximum posts |

### `get_post`
Get a post and its comments. `subreddit` may also be a username (profile posts resolve via `/user/` fallback).

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `subreddit` | yes | — | Subreddit name, or username for profile posts |
| `postId` | yes | — | Reddit post ID (from search/hot results) |
| `comment_sort` | no | `confidence` | `confidence`, `top`, `new`, `controversial`, `old` |
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
| `sort` | no | `hot` | `hot`, `new`, `top`, `controversial` |
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
│   └── tools.ts          # Tool registration and handlers
├── tests/
│   ├── fixtures/         # HTML fixtures for parser tests
│   ├── parsers.test.ts   # Parser unit tests
│   ├── integration.test.ts
│   └── qa.test.ts
├── package.json
└── README.md
```

### Build & Test

```bash
npm install
npm run build
npm test
```

## License

MIT

## Acknowledgments

- [Redlib](https://github.com/redlib-org/redlib) — The private Reddit front-end
- [Model Context Protocol](https://modelcontextprotocol.io/) — The protocol
- [Cheerio](https://github.com/cheeriojs/cheerio) — HTML parsing
- [Devthatdoes](https://github.com/Devthatdoes/redlib-mcp-server) — Original MCP server
