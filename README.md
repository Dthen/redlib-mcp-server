#  Redlib MCP Server

[![Docker Pulls](https://img.shields.io/docker/pulls/alfafadock/mcp-redlib?label=docker%20pulls)](https://hub.docker.com/r/alfafadock/mcp-redlib)
[![Docker Image Size](https://img.shields.io/docker/image-size/alfafadock/mcp-redlib/latest)](https://hub.docker.com/r/alfafadock/mcp-redlib)

A **Model Context Protocol (MCP) server** that enables AI agents to interact with Reddit through your private **Redlib** instance. No Reddit API keys required - just a running Redlib instance!

---





https://github.com/user-attachments/assets/66eec084-e911-4eed-a51f-be303e86f1a7







##  Table of Contents

- [Features](#-features)
- [Current Implementation](#-current-implementation)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Available Tools](#️-available-tools)
- [Integration with AI Clients](#-integration-with-ai-clients)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code / GitHub Copilot](#vs-code--github-copilot)
  - [OpenAI Codex](#openai-codex)
  - [ForgeCode](#forgecode)
  - [KiloCode](#kilocode)
- [Docker Compose](#-docker-compose)
- [Security: Default vs Hardened](#-security-default-vs-hardened)
- [Development](#-development)
- [Example Usage with AI](#-example-usage-with-ai)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgments](#-acknowledgments)
- [Links](#-links)

---

##  Features

-  **Privacy-First** - Uses your self-hosted Redlib, no tracking or API keys
-  **9 Powerful Tools** - Search posts, subreddits, users; browse front page, user profiles, wiki pages; fetch posts with comments
-  **Docker Ready** - Both simple and hardened Docker images available
-  **Easy Setup** - Works with Claude Desktop, Cursor, VS Code, Codex, ForgeCode, KiloCode and any MCP-compatible client
-  **Structured Output** - Returns clean JSON instead of raw HTML

---

##  Current Implementation: Stdio Transport

**Important**: This server currently uses **stdio transport** (stdin/stdout communication) for local development. It runs as a child process and communicates through standard input/output.

### What This Means:
- **No HTTP endpoint** - The server does not expose any HTTP ports
- **Local-only** - Designed for local development and testing scenarios
- **Child process** - MCP clients spawn this server as a subprocess
- **No network access** - All communication happens locally via stdin/stdout

### Future Plans:
HTTP transport functionality is planned for future releases to enable:
- Remote access over HTTP
- Multiple concurrent client connections
- Production deployment scenarios
- Network-based health checks

---

##  Prerequisites

Before using this MCP server, you need:

1. **Redlib Instance** - A running Redlib instance (default: `http://localhost:8080`)
   - [Redlib GitHub](https://github.com/redlib-org/redlib)
   - [Redlib Docker Setup](https://github.com/redlib-org/redlib#docker)

2. **MCP Client** - One of:
   - [Claude Desktop](https://claude.ai/download)
   - [Cursor](https://cursor.sh/)
   - [VS Code](https://code.visualstudio.com/) with GitHub Copilot
   - [OpenAI Codex](https://openai.com/index/introducing-codex/)
   - [ForgeCode](https://github.com/tailcallhq/forgecode)
   - [KiloCode](https://kilo.ai/)

---

##  Quick Start

### Option 1: Docker (Recommended)

```bash
# Pull and run the default version
docker run -i --rm \
  --network host \
  -e REDLIB_URL=http://localhost:8080 \
  alfafadock/mcp-redlib:latest
```

### Option 2: Hardened Docker (Security-Focused)

```bash
# Uses non-root user and minimal privileges
docker run -i --rm \
  --network host \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  -e REDLIB_URL=http://localhost:8080 \
  alfafadock/mcp-redlib:hardened
```

### Option 3: Local Development

```bash
# Clone and setup
git clone https://github.com/Devthatdoes/redlib-mcp-server.git
cd redlib-mcp-server

# Install dependencies
npm install

# Build
npm run build

# Run
npm start
```

---

##  Docker Compose

<details>
<summary>Click to expand Docker Compose setup</summary>

Create `docker-compose.yml`:

```yaml
services:
  redlib-mcp:
    image: alfafadock/mcp-redlib:latest
    container_name: redlib-mcp
    network_mode: "host"  # Uses host network for MCP client communication
    environment:
      - REDLIB_URL=http://localhost:8080  # Change if Redlib is on a different port
    restart: unless-stopped
    # For hardened image, change image to: alfafadock/mcp-redlib:hardened
```
</details>

---

##  Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDLIB_URL` | `http://localhost:8080` | URL of your Redlib instance |
| `REDLIB_PUBLIC_URL` | `https://www.reddit.com` | Public base URL used for permalinks and flair filter links in tool output (the private instance URL is useless to consumers). Set it to a public Redlib mirror if you prefer. Trailing slashes are stripped. |

### Custom Redlib Port Example

If your Redlib runs on a different port (e.g., 8085):

```bash
docker run -i --rm \
  --network host \
  -e REDLIB_URL=http://localhost:8085 \
  alfafadock/mcp-redlib:latest
```

### Example `.env` File

Copy `.env.example` to `.env` and modify as needed:

```bash
cp .env.example .env
```

---

##  Available Tools

### 1. `search_posts`
Search Reddit posts using your private Redlib instance. Supports sort order, time filter, and subreddit scoping.

**Parameters:**
- `query` (required) - Search query string
- `subreddit` (optional) - Limit search to a specific subreddit
- `sort` (optional) - Sort order: `relevance`, `hot`, `top`, `new`, `comments` (default: `relevance`)
- `t` (optional) - Time filter: `hour`, `day`, `week`, `month`, `year`, `all` (only applies when sort is `relevance` or `comments`)
- `limit` (optional) - Maximum results (default: 25)

**Example — global search:**
```json
{
  "query": "rust programming",
  "sort": "top",
  "t": "month",
  "limit": 10
}
```

**Example — scoped to a subreddit:**
```json
{
  "query": "async patterns",
  "subreddit": "rust",
  "sort": "relevance",
  "limit": 15
}
```

**Returns:** JSON with query, sort, result count, and posts (IDs, titles, authors, scores, comment counts).

---

### 2. `get_posts`
Get posts from a specific subreddit. Supports all sort modes (hot, new, top, rising, controversial) and time filters for top/controversial.

**Parameters:**
- `subreddit` (required) - Subreddit name (without r/)
- `sort` (optional) - Sort mode: `hot`, `new`, `top`, `rising`, `controversial` (default: `hot`)
- `t` (optional) - Time filter: `hour`, `day`, `week`, `month`, `year`, `all` (only applies when sort is `top` or `controversial`)
- `limit` (optional) - Maximum posts (default: 25)

**Example:**
```json
{
  "subreddit": "rust",
  "sort": "top",
  "t": "week",
  "limit": 10
}
```

**Returns:** JSON with subreddit, sort, time filter, result count, and posts.

---

### 3. `get_post`
Get a specific Reddit post and its comments. Use post ID from search or hot post results. `subreddit` may also be a username: profile posts resolve via a `/user/` fallback when the `/r/` path returns 404.

**Parameters:**
- `subreddit` (required) - Subreddit name, or username for user-profile posts
- `postId` (required) - Reddit post ID (from search/hot results)
- `comment_sort` (optional) - Comment sort order: `confidence`, `top`, `new`, `controversial`, `old` (Redlib default is confidence)
- `comment_limit` (optional) - Maximum comments to return (default: 10)

**Example:**
```json
{
  "subreddit": "rust",
  "postId": "1abc234",
  "comment_sort": "top",
  "comment_limit": 20
}
```

**Returns:** Full post body (selftext), title, author, score, upvote ratio, post URL, and comments sorted as requested.

---

### 4. `search_subreddits`
Search for subreddits on Reddit via Redlib. Returns subreddit names, subscriber counts, and descriptions.

**Parameters:**
- `query` (required) - Search query for subreddits
- `limit` (optional) - Maximum results (default: 25)

**Example:**
```json
{
  "query": "machine learning",
  "limit": 10
}
```

**Returns:** JSON with query, result count, and subreddits (name, subscriber count, description).

---

### 5. `search_users`
Search for Reddit users via Redlib. Returns usernames and optional profile descriptions.

**Parameters:**
- `query` (required) - Search query for users
- `limit` (optional) - Maximum results (default: 25)

**Example:**
```json
{
  "query": "rustacean developer",
  "limit": 10
}
```

**Returns:** JSON with query, result count, and users (username, optional description).

---

### 6. `get_subreddit_info`
Get detailed information about a subreddit (description, rules, subscriber count, etc.) from the Redlib sidebar page.

**Parameters:**
- `subreddit` (required) - Subreddit name (without r/)

**Example:**
```json
{
  "subreddit": "rust"
}
```

**Returns:** JSON with subreddit name, title, description, subscriber count, active users, creation date, and rules (if any).

---

### 7. `get_user`
Get a Reddit user's profile information, posts, and comments via Redlib. Supports listing type, sort, and time filters.

**Parameters:**
- `username` (required) - Reddit username (without u/)
- `listing` (optional) - Content listing type: `overview`, `submitted`, `comments` (default: `overview`)
- `sort` (optional) - Sort order: `hot`, `new`, `top`, `controversial`
- `t` (optional) - Time filter: `hour`, `day`, `week`, `month`, `year`, `all` (only applies when sort is `top` or `controversial`)
- `limit` (optional) - Maximum posts/comments to return (default: 25)

**Example:**
```json
{
  "username": "burntsushi",
  "listing": "submitted",
  "sort": "top",
  "t": "year",
  "limit": 10
}
```

**Returns:** JSON with username, karma, cake day, description, post/comment counts, posts array, and comments array.

---

### 8. `get_front_page`
Get posts from the Reddit front page — either the popular feed or r/all. Supports sort modes and time filters.

**Parameters:**
- `feed` (optional) - Feed type: `popular` (default Reddit front page) or `all` (r/all) (default: `popular`)
- `sort` (optional) - Sort mode: `hot`, `new`, `top`, `rising`, `controversial` (default: `hot`)
- `t` (optional) - Time filter: `hour`, `day`, `week`, `month`, `year`, `all` (only applies when sort is `top` or `controversial`)
- `limit` (optional) - Maximum posts (default: 25)

**Example — popular front page:**
```json
{
  "feed": "popular",
  "sort": "hot",
  "limit": 25
}
```

**Example — r/all top of the day:**
```json
{
  "feed": "all",
  "sort": "top",
  "t": "day",
  "limit": 15
}
```

**Returns:** JSON with feed, sort, time filter (if applicable), result count, and posts.

---

### 9. `get_wiki_page`
Get the contents of a subreddit's wiki page via Redlib.

**Parameters:**
- `subreddit` (required) - Subreddit name (without r/)
- `page` (optional) - Wiki page name (default: `index`)

**Example — subreddit wiki index:**
```json
{
  "subreddit": "rust"
}
```

**Example — specific wiki page:**
```json
{
  "subreddit": "rust",
  "page": "books"
}
```

**Returns:** JSON with the wiki page title and full wiki content.

---

## 🔌 Integration with AI Clients

### Claude Desktop

Edit `~/.config/claude/claude_desktop_config.json` (Linux/macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network", "host",
        "-e", "REDLIB_URL=http://localhost:8080",
        "alfafadock/mcp-redlib:latest"
      ]
    }
  }
}
```

**For custom Redlib port (e.g., 8085):**
```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network", "host",
        "-e", "REDLIB_URL=http://localhost:8085",
        "alfafadock/mcp-redlib:latest"
      ]
    }
  }
}
```

**After updating:** Restart Claude Desktop. You should see a hammer icon (🔨) indicating MCP tools are available.

*Reference: [Claude Desktop MCP Docs](https://modelcontextprotocol.io/docs/develop/connect-local-servers)*

---

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project level):

```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
    }
  }
}
```

**Project-level setup:** Create `.cursor/mcp.json` in your project root.

**After updating:** Cursor will automatically detect the changes. Use the Command Palette (Cmd/Ctrl+Shift+P) and search for "MCP" to manage servers.

*Reference: [Cursor MCP Documentation](https://cursor.com/docs/mcp)*

---

### VS Code / GitHub Copilot

#### Option A: Workspace Configuration
Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "redlib": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
    }
  }
}
```

#### Option B: User Configuration (Global)
Use Command Palette (Cmd/Ctrl+Shift+P) → "MCP: Open User Configuration":

```json
{
  "mcp": {
    "servers": {
      "redlib": {
        "command": "docker",
        "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
      }
    }
  }
}
```

**After updating:** Reload VS Code. The tools will appear in GitHub Copilot's Agent Mode.

*Reference: [VS Code MCP Documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)*

---

### OpenAI Codex

Edit `~/.codex/config.toml` (global) or `.codex/config.toml` (project):

```toml
[mcp_servers.redlib]
command = "docker"
args = ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
```

**Project-level setup:** Create `.codex/config.toml` in your project root.

**After updating:** Restart Codex. Use `codex mcp list` to verify the server is loaded.

*Reference: [Codex MCP Documentation](https://developers.openai.com/codex/mcp)*

---

### ForgeCode

ForgeCode supports MCP servers via the **`forge mcp`** command for easy import.

#### Option A: Quick Import (Recommended)

Use the built-in MCP import functionality:

```bash
# Import the Redlib MCP server
forge mcp import alfafadock/mcp-redlib:latest

# List imported servers
forge mcp list

# Reload to apply changes
forge mcp reload
```

#### Option B: Project Configuration
Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
    }
  }
}
```

#### Option C: Global Configuration
Edit ForgeCode's config directory (check extension settings for the exact path).

**After updating:** Reload the ForgeCode extension using `forge mcp reload`. The MCP tools should appear in the AI assistant interface.

*Reference: [ForgeCode Documentation](https://forgecode.dev/docs/mcp-integration/)*

---

### KiloCode

#### Option A: Global Configuration
Edit `~/.config/kilo/kilo.jsonc` or use Settings → MCP in KiloCode:

```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
    }
  }
}
```

#### Option B: Project Configuration
Create `.kilocode/mcp.json` or `kilo.jsonc` in your project root:

```json
{
  "mcpServers": {
    "redlib": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "REDLIB_URL=http://localhost:8080", "alfafadock/mcp-redlib:latest"]
    }
  }
}
```

**After updating:** Open KiloCode Settings → MCP → Add Server, or edit the config file directly.

*Reference: [KiloCode MCP Documentation](https://kilo.ai/docs/automate/mcp/using-in-kilo-code)*

---

##  Security: Default vs Hardened
| Feature | Default (`latest`) | Hardened (`hardened`) |
|---------|-------------------|---------------------|
| **User** | root | Non-root (mcpuser) |
| **File Ownership** | root | mcpuser |
| **Build Stages** | Single | Multi-stage (smaller) |
| **Runtime Caps** | Default | Requires `--cap-drop=ALL` |
| **Use Case** | Development, testing | Production |

### Using Hardened Image

```bash
docker run -i --rm \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --network host \
  -e REDLIB_URL=http://localhost:8080 \
  alfafadock/mcp-redlib:hardened
```

---

##  Development

### Project Structure

```
redlib-mcp-server/
├── src/
│   └── index.ts          # Main server code (stdio transport)
├── dist/                  # Compiled JavaScript (gitignored)
├── Dockerfile             # Default Docker image
├── Dockerfile.hardened    # Hardened Docker image
├── docker-compose.yml     # Production compose
├── package.json
├── tsconfig.json
└── README.md
```

### Build from Source

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run locally
npm start
```

### Build Custom Docker Images

```bash
# Default version
docker build -t redlib-mcp-server .

# Hardened version
docker build -f Dockerfile.hardened -t redlib-mcp-server:hardened .
```

---

##  Example Usage with AI

Once connected to your AI client (e.g., Claude), you can:

```
User: "Search Reddit for 'home lab setup' and summarize the top results"

AI uses search_posts tool →
Returns structured JSON with posts →
AI summarizes the findings for you
```

```
User: "Get the full post and comments for that Rust tutorial I searched earlier"

AI uses get_post with postId →
Returns post body + comments →
AI provides detailed analysis
```

---

##  Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

##  License

MIT License - feel free to use this project however you want!

---

##  Acknowledgments

- [Redlib](https://github.com/redlib-org/redlib) - The private Reddit front-end this server interfaces with
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol that makes this integration possible
- [Cheerio](https://github.com/cheeriojs/cheerio) - HTML parsing library used to extract structured data

---

##  Links

- **Docker Hub**: [alfafadock/mcp-redlib](https://hub.docker.com/r/alfafadock/mcp-redlib)
- **Issues**: [GitHub Issues](https://github.com/Devthatdoes/redlib-mcp-server/issues)
- **Redlib**: [github.com/redlib-org/redlib](https://github.com/redlib-org/redlib)

---

<p align="center">Made with ❤️ for the privacy-conscious Reddit community</p>
