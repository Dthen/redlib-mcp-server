/**
 * Task 7 — stdio JSON-RPC smoke harness for the built candidate (dist/index.js).
 *
 * Default (mock) mode: starts a local HTTP fixture server on 127.0.0.1,
 * spawns the compiled server with a scoped REDLIB_URL, and exercises every
 * supported post-reference form through the real MCP protocol boundary:
 * initialize (protocol 2025-11-25), notifications/initialized, tools/list and
 * tools/call — all over stdio JSON-RPC 2.0 against the compiled child. No
 * internet access is used; all traffic stays on loopback. The fixture serves
 * a synthetic post page (with more top-level comments than the default
 * comment_limit) plus a valid-base36-id route (/comments/errorpost) that
 * returns HTTP 200 with an error page, so the handler's invalid-page guard
 * is exercised through a real compiled JSON-RPC call.
 *
 * Live mode (--live): requires a reachable Redlib at REDLIB_URL (default
 * http://127.0.0.1:8080). A bounded 3s upstream probe runs BEFORE any child
 * spawn; if the upstream is unreachable the live cases are recorded as
 * BLOCKED (never as a fake pass). Otherwise exactly 3 bounded get_post calls
 * are made (legacy ID carrying comment_sort=new + comment_limit=1, full
 * share URL, bare share fragment) for the known post 1x7hpcl, asserting
 * identical id/subreddit/title/body across forms and the exact knockknock
 * repo URL in every body.
 *
 * The harness NEVER imports tool handlers or copies parser logic: every
 * assertion is produced by the compiled child process speaking JSON-RPC 2.0
 * over stdio (protocol version 2025-11-25).
 *
 * Lifecycle: the child is killed (SIGTERM, then SIGKILL escalation) and its
 * exit awaited in a finally; the fixture server is closed (connections
 * drained) in a finally even when the spawn fails; an overall deadline
 * triggers the same awaited cleanup before exiting. Per-call and startup
 * timeouts are removed — the overall deadline is the only watchdog.
 *
 * Exit codes:
 *   0  all cases passed
 *   1  at least one case failed (or the harness errored)
 *   2  usage error (unknown or conflicting args) — before any spawn/network
 *   3  overall deadline exceeded (awaited cleanup, then exit)
 *   4  live upstream blocked, no failures
 *
 * Usage:
 *   ./node_modules/.bin/tsx tests/mcp-smoke.ts           # mock mode
 *   ./node_modules/.bin/tsx tests/mcp-smoke.ts --mock    # explicit mock
 *   REDLIB_URL=http://127.0.0.1:8080 ./node_modules/.bin/tsx tests/mcp-smoke.ts --live
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// ── constants ──────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2025-11-25";
const FIXTURE_POST_ID = "1x7hpcl";
const FIXTURE_SUBREDDIT = "webscraping";
const FIXTURE_SHARE_TOKEN = "yf4R7bbaHP";
const FIXTURE_REPO_URL = "https://github.com/jeheskielSunloy77/knockknock";
const FIXTURE_POST_TITLE = "Synthetic Fixture Post Title";
const FIXTURE_POST_BODY =
  "Synthetic fixture body content for the MCP smoke harness. NOT a real Reddit capture.";
const ERROR_POST_ID = "errorpost";
const SYNTHETIC_COMMENT_COUNT = 12;
const DEFAULT_COMMENT_LIMIT = 10;
const LIVE_COMMENT_SORT = "new";
const LIVE_COMMENT_LIMIT = 1;
const DEFAULT_LIVE_URL = "http://127.0.0.1:8080";
const OVERALL_DEADLINE_MS = 60_000;
const UPSTREAM_PROBE_TIMEOUT_MS = 3_000;
const KILL_GRACE_MS = 2_000;

// ── JSON-RPC types ─────────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// ── ledger ─────────────────────────────────────────────────────────────────

type CaseStatus = "PASS" | "FAIL" | "BLOCKED";

interface CaseResult {
  name: string;
  status: CaseStatus;
  detail: string;
}

const ledger: CaseResult[] = [];

function record(name: string, status: CaseStatus, detail: string): void {
  ledger.push({ name, status, detail });
  console.log(`  [${status}] ${name}: ${detail}`);
}

// ── fixture HTML ──────────────────────────────────────────────────────────

function syntheticComment(index: number): string {
  const id = `fixture_c${index}`;
  return `
<div id="${id}" class="comment">
  <div class="comment_left">
    <p class="comment_score" title="${index}">${index}</p>
    <div class="line"></div>
  </div>
  <details class="comment_right" open>
    <summary class="comment_data">
      <a class="comment_author" href="/user/fixture_commenter_${index}">u/fixture_commenter_${index}</a>
      <a href="/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}/${id}/?context=3#${id}" class="created" title="2025-01-01T00:00:${String(index).padStart(2, "0")}Z">1 year ago</a>
    </summary>
    <div class="comment_body "><div class="md"><p>Synthetic fixture comment number ${index}.</p></div></div>
    <blockquote class="replies"></blockquote>
  </details>
</div>`;
}

const FIXTURE_POST_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>${FIXTURE_POST_TITLE} — smoke test</title></head>
<body>
<main>
<div id="column_one">
<div class="post" id="${FIXTURE_POST_ID}">
<p class="post_header">
  <a class="post_subreddit" href="/r/${FIXTURE_SUBREDDIT}">r/${FIXTURE_SUBREDDIT}</a>
  <span class="dot">&bull;</span>
  <a class="post_author" href="/user/fixture_user">u/fixture_user</a>
  <span class="dot">&bull;</span>
  <span class="created" title="2025-01-01T00:00:00Z">1 year ago</span>
</p>
<h1 class="post_title"><a href="/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}">${FIXTURE_POST_TITLE}</a></h1>
<div class="post_body"><p>${FIXTURE_POST_BODY}</p></div>
<div class="post_score" title="42">42<span class="label"> Upvotes</span></div>
<div class="post_footer"><ul id="post_links"><li><a href="/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}/"><span class="desktop_item">perma</span>link</a></li></ul></div>
</div>
<div class="thread">
${Array.from({ length: SYNTHETIC_COMMENT_COUNT }, (_, i) => syntheticComment(i + 1)).join("")}
</div>
</div>
</main>
</body>
</html>`;

const ERROR_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Error</title></head>
<body><p>Something went wrong. This is a synthetic error page.</p></body>
</html>`;

function sendHtml(res: ServerResponse, status: number, html: string): void {
  const buf = Buffer.from(html);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(buf.length),
  });
  res.end(buf);
}

// ── fixture server ────────────────────────────────────────────────────────

interface FixtureServer {
  server: HttpServer;
  port: number;
  requests: string[];
}

function createFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/";
    requests.push(rawUrl);
    // Route on the pathname so a forwarded `?sort=new` still matches.
    const path = new URL(rawUrl, "http://fixture.invalid").pathname;

    // Share reference: 302 redirect to the canonical comment page
    if (path === `/r/${FIXTURE_SUBREDDIT}/s/${FIXTURE_SHARE_TOKEN}`) {
      res.writeHead(302, {
        "location": `/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}`,
        "content-length": "0",
      });
      res.end();
      return;
    }

    // Post detail pages (scoped and unscoped)
    if (
      path === `/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}` ||
      path === `/comments/${FIXTURE_POST_ID}`
    ) {
      sendHtml(res, 200, FIXTURE_POST_HTML);
      return;
    }

    // HTTP 200 with a valid-base36 id but unusable (error) page content.
    if (path === `/comments/${ERROR_POST_ID}`) {
      sendHtml(res, 200, ERROR_PAGE_HTML);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain", "content-length": "7" });
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port, requests });
    });
  });
}

// ── resource registry + cleanup (shared by run modes and the deadline) ─────

const activeFixture: { current: FixtureServer | null } = { current: null };
const activeChild: { current: ChildProcess | null } = { current: null };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(KILL_GRACE_MS).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
  if (child.exitCode === null) {
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(KILL_GRACE_MS),
    ]);
  }
}

async function closeFixture(fixture: FixtureServer | null): Promise<void> {
  if (!fixture) return;
  fixture.server.closeAllConnections?.();
  if (fixture.server.listening) {
    await new Promise<void>((resolve) => {
      fixture.server.close(() => resolve());
    });
  }
}

async function emergencyShutdown(): Promise<void> {
  const fixture = activeFixture.current;
  const child = activeChild.current;
  activeFixture.current = null;
  activeChild.current = null;
  await Promise.all([closeFixture(fixture), killChild(child)]);
}

// ── child process / JSON-RPC client ────────────────────────────────────────

interface RPCTransport {
  send: (msg: JSONRPCRequest) => void;
  call: (msg: JSONRPCRequest) => Promise<JSONRPCResponse>;
  close: () => Promise<void>;
  stderrLines: string[];
}

interface SpawnedCandidate {
  transport: RPCTransport;
  init: JSONRPCResponse;
}

function spawnCandidate(distPath: string, env: Record<string, string>): Promise<SpawnedCandidate> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", [distPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChild.current = child;

    const stderrLines: string[] = [];
    let stdoutBuffer = "";
    let nextId = 1;
    const pending = new Map<number, { resolve: (r: JSONRPCResponse) => void; reject: (e: Error) => void }>();
    let settled = false;

    child.stdout!.setEncoding("utf-8");
    child.stdout!.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? ""; // keep partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          const msg = JSON.parse(trimmed) as JSONRPCResponse;
          if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) {
              reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
            } else {
              resolve(msg);
            }
          }
        } catch {
          // Non-JSON stdout line (shouldn't happen with MCP stdio, but ignore)
        }
      }
    });

    child.stderr!.setEncoding("utf-8");
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) stderrLines.push(line.trim());
      }
    });

    child.once("error", (err) => {
      if (!settled) {
        settled = true;
        activeChild.current = null;
        reject(new Error(`Failed to spawn child: ${err.message}`));
      }
    });

    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        activeChild.current = null;
        reject(new Error(`Child exited before ready: code=${code} signal=${signal}`));
      }
    });

    // Send initialize and wait for response
    const initId = nextId++;
    const initMsg: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-smoke-harness", version: "1.0.0" },
      },
    };
    const initPromise = new Promise<JSONRPCResponse>((res, rej) => {
      pending.set(initId, { resolve: res, reject: rej });
    });

    // Write initialize (child reads from stdin)
    child.stdin!.write(JSON.stringify(initMsg) + "\n");

    // MCP handshake: wait for initialize response BEFORE sending
    // notifications/initialized (JSON-RPC 2.0 notification: NO id field)
    initPromise
      .then((initResp) => {
        if (initResp.error) {
          throw new Error(`JSON-RPC error ${initResp.error.code}: ${initResp.error.message}`);
        }
        child.stdin!.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n");
        settled = true;
        resolve({
          transport: {
            send: (msg) => {
              child.stdin!.write(JSON.stringify(msg) + "\n");
            },
            call: (msg: JSONRPCRequest) => {
              return new Promise<JSONRPCResponse>((res, rej) => {
                const id = nextId++;
                const fullMsg = { ...msg, id };
                pending.set(id, { resolve: res, reject: rej });
                child.stdin!.write(JSON.stringify(fullMsg) + "\n");
              });
            },
            close: async () => {
              for (const [id, p] of pending) p.reject(new Error("transport closed"));
              pending.clear();
              activeChild.current = null;
              await killChild(child);
            },
            stderrLines,
          },
          init: initResp,
        });
      })
      .catch((err) => {
        activeChild.current = null;
        reject(err);
      });
  });
}

// ── MCP helpers ────────────────────────────────────────────────────────────

async function listTools(transport: RPCTransport): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
  const resp = await transport.call({
    jsonrpc: "2.0",
    id: 0,
    method: "tools/list",
    params: {},
  });
  if (resp.error) throw new Error(`tools/list failed: ${resp.error.message}`);
  return (resp.result as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools;
}

async function callTool(
  transport: RPCTransport,
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  const resp = await transport.call({
    jsonrpc: "2.0",
    id: 0,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (resp.error) {
    throw new Error(`tools/call transport error: ${resp.error.message}`);
  }
  return resp.result as ToolCallResult;
}

/** Parse a successful tool result's JSON payload; {} when errored or unparseable. */
function parseResultBody(result: ToolCallResult): Record<string, unknown> {
  if (result.isError === true) return {};
  const text = result.content[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — treat as no payload
  }
  return {};
}

// ── mock mode ──────────────────────────────────────────────────────────────

async function runMockMode(): Promise<void> {
  console.log("\n── Mock mode (hermetic fixture, no internet) ──");

  const fixture = await createFixtureServer();
  activeFixture.current = fixture;
  const fixtureUrl = `http://127.0.0.1:${fixture.port}`;

  // Clear request log before test calls
  fixture.requests.length = 0;

  try {
    const { transport, init } = await spawnCandidate("dist/index.js", {
      REDLIB_URL: fixtureUrl,
      REDLIB_PUBLIC_URL: "https://www.reddit.com",
    });

    try {
      // 0. initialize — protocol negotiation + serverInfo
      const initResult = init.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
      const protocolOk =
        initResult?.protocolVersion === PROTOCOL_VERSION &&
        typeof initResult?.serverInfo?.name === "string" &&
        initResult.serverInfo.name.length > 0;
      record(
        "initialize: protocol 2025-11-25 negotiated, serverInfo present",
        protocolOk ? "PASS" : "FAIL",
        `protocolVersion=${initResult?.protocolVersion} serverInfo=${JSON.stringify(initResult?.serverInfo)}`
      );

      // 1. tools/list — verify 10 tools
      const tools = await listTools(transport);
      const toolNames = tools.map((t) => t.name).sort();

      const EXPECTED_TOOLS = [
        "get_post",
        "get_posts",
        "get_subreddit_info",
        "get_user",
        "get_wiki_page",
        "get_front_page",
        "search_posts",
        "search_subreddits",
        "search_users",
        "search_comments",
      ].sort();

      const toolsOk = JSON.stringify(toolNames) === JSON.stringify(EXPECTED_TOOLS);
      record("tools/list: 10 tools present", toolsOk ? "PASS" : "FAIL", `got [${toolNames.join(", ")}]`);

      // 2. get_post schema — postId required with explicit minLength, hint
      //    optional, comment_sort present, comment_limit default 10
      const getPost = tools.find((t) => t.name === "get_post");
      if (!getPost) {
        record("get_post schema: postId required, subreddit optional, comment_limit default 10", "FAIL", "tool not found");
      } else {
        const schema = getPost.inputSchema as {
          properties: Record<string, unknown>;
          required?: string[];
        };
        const props = schema.properties;
        const required = schema.required ?? [];
        const postIdSchema = props.postId as { type?: string; minLength?: number };
        const limitSchema = props.comment_limit as { type?: string; default?: number };

        const schemaOk =
          required.includes("postId") &&
          postIdSchema.minLength === 1 &&
          props.subreddit !== undefined &&
          !required.includes("subreddit") &&
          props.comment_sort !== undefined &&
          limitSchema.type === "number" &&
          limitSchema.default === DEFAULT_COMMENT_LIMIT;

        record(
          "get_post schema: postId required (minLength 1), subreddit optional, comment_sort present, comment_limit default 10",
          schemaOk ? "PASS" : "FAIL",
          `required=[${required}] postId.minLength=${postIdSchema.minLength} comment_limit=${JSON.stringify(limitSchema)}`
        );
      }

      // 3. Legacy ID with subreddit hint — success plus default-limit behavior:
      //    the fixture carries 12 top-level comments and no comment_limit is
      //    passed, so the MCP boundary default (10) must truncate the list.
      {
        const result = await callTool(transport, "get_post", {
          postId: FIXTURE_POST_ID,
          subreddit: FIXTURE_SUBREDDIT,
        });
        const body = parseResultBody(result) as {
          id?: string;
          subreddit?: string;
          title?: string;
          commentCount?: number;
          comments?: unknown[];
        };
        const ok =
          result.isError !== true &&
          body.id === FIXTURE_POST_ID &&
          body.subreddit === FIXTURE_SUBREDDIT &&
          body.title === FIXTURE_POST_TITLE &&
          body.commentCount === SYNTHETIC_COMMENT_COUNT &&
          Array.isArray(body.comments) &&
          body.comments.length === DEFAULT_COMMENT_LIMIT;
        record(
          `get_post: legacy ID + subreddit hint → id=${FIXTURE_POST_ID}; default limit truncates ${SYNTHETIC_COMMENT_COUNT} → ${DEFAULT_COMMENT_LIMIT} comments`,
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} id=${body.id} subreddit=${body.subreddit} title="${body.title}" commentCount=${body.commentCount} comments=${(body.comments ?? []).length}`
        );
      }

      // 4. Unscoped /comments/<id>
      {
        const result = await callTool(transport, "get_post", {
          postId: `/comments/${FIXTURE_POST_ID}`,
        });
        const body = parseResultBody(result) as { id?: string };
        const ok = result.isError !== true && body.id === FIXTURE_POST_ID;
        record(
          `get_post: unscoped /comments/${FIXTURE_POST_ID}`,
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} id=${body.id}`
        );
      }

      // 5. Full share URL (www.reddit.com/r/<sub>/s/<token>) — triggers 302
      {
        const result = await callTool(transport, "get_post", {
          postId: `https://www.reddit.com/r/${FIXTURE_SUBREDDIT}/s/${FIXTURE_SHARE_TOKEN}`,
        });
        const body = parseResultBody(result) as { id?: string };
        const shareSeen = fixture.requests.includes(`/r/${FIXTURE_SUBREDDIT}/s/${FIXTURE_SHARE_TOKEN}`);
        const ok = result.isError !== true && body.id === FIXTURE_POST_ID && shareSeen;
        record(
          `get_post: full share URL → 302 → /r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}`,
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} id=${body.id} sharePathSeen=${shareSeen}`
        );
      }

      // 6. Bare share fragment with subreddit hint
      {
        const result = await callTool(transport, "get_post", {
          postId: `s/${FIXTURE_SHARE_TOKEN}`,
          subreddit: FIXTURE_SUBREDDIT,
        });
        const body = parseResultBody(result) as { id?: string };
        const ok = result.isError !== true && body.id === FIXTURE_POST_ID;
        record(
          `get_post: bare share fragment s/${FIXTURE_SHARE_TOKEN} + hint`,
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} id=${body.id}`
        );
      }

      // 7. Invalid host — must be rejected
      {
        const result = await callTool(transport, "get_post", {
          postId: `https://evil.com/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}`,
        });
        const text = result.content[0]?.text ?? "";
        const ok = result.isError === true && text.includes("Unsupported post reference");
        record(
          "get_post: invalid host rejected",
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} text="${text.slice(0, 90)}"`
        );
      }

      // 8. HTTP 200 invalid page — a valid base36 id whose route returns 200
      //    with unusable HTML must produce the error envelope (not post JSON),
      //    and the fixture must show the invalid page was actually served.
      {
        const result = await callTool(transport, "get_post", { postId: ERROR_POST_ID });
        const text = result.content[0]?.text ?? "";
        const errorPageSeen = fixture.requests.includes(`/comments/${ERROR_POST_ID}`);
        const ok =
          result.isError === true &&
          text.startsWith("Error fetching post:") &&
          text.includes("No valid post") &&
          !text.includes('"id"') &&
          errorPageSeen;
        record(
          `get_post: HTTP 200 invalid page (/comments/${ERROR_POST_ID}) → error envelope, not post JSON`,
          ok ? "PASS" : "FAIL",
          `isError=${result.isError} envelope=${text.startsWith("Error fetching post:")} diagnostic=${text.includes("No valid post")} notPostJson=${!text.includes('"id"')} fixtureObserved=${errorPageSeen}`
        );
      }

      // 9. Fixture observation — every reference form hit the local fixture
      {
        const observed = [
          `/r/${FIXTURE_SUBREDDIT}/comments/${FIXTURE_POST_ID}`,
          `/comments/${FIXTURE_POST_ID}`,
          `/r/${FIXTURE_SUBREDDIT}/s/${FIXTURE_SHARE_TOKEN}`,
          `/comments/${ERROR_POST_ID}`,
        ];
        const missing = observed.filter((r) => !fixture.requests.includes(r));
        record(
          "fixture observation: scoped + unscoped + share + error-page paths hit the local fixture",
          missing.length === 0 ? "PASS" : "FAIL",
          `observed=${observed.map((r) => `${r}:${fixture.requests.includes(r)}`).join(", ")} missing=[${missing.join(", ")}]`
        );
      }
    } finally {
      await transport.close();
    }
  } finally {
    activeFixture.current = null;
    await closeFixture(fixture);
  }
}

// ── live mode ──────────────────────────────────────────────────────────────

/** Bounded reachability probe; undefined when the upstream answered. */
async function probeUpstream(redlibUrl: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_PROBE_TIMEOUT_MS);
  try {
    await fetch(`${redlibUrl.replace(/\/+$/, "")}/`, { signal: controller.signal });
    return undefined; // any HTTP response means the upstream is reachable
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveMode(redlibUrl: string): Promise<void> {
  console.log(`\n── Live mode (bounded comparison against ${redlibUrl}) ──`);
  console.log("  Testing original share / URL / legacy forms for post 1x7hpcl (knockknock repo)");

  // Bounded upstream probe BEFORE spawning any child.
  const probeError = await probeUpstream(redlibUrl);
  if (probeError !== undefined) {
    record(`live: upstream ${redlibUrl} reachable`, "BLOCKED", `probe failed: ${probeError}`);
    record("live: 3 form comparison (legacy / share URL / fragment)", "BLOCKED", `skipped: ${probeError}`);
    return;
  }
  record(`live: upstream ${redlibUrl} reachable`, "PASS", `probe GET ${redlibUrl}/ answered`);

  const { transport, init } = await spawnCandidate("dist/index.js", {
    REDLIB_URL: redlibUrl,
    REDLIB_PUBLIC_URL: "https://www.reddit.com",
  });

  try {
    // initialize — protocol negotiation + serverInfo
    const initResult = init.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
    const protocolOk =
      initResult?.protocolVersion === PROTOCOL_VERSION &&
      typeof initResult?.serverInfo?.name === "string" &&
      initResult.serverInfo.name.length > 0;
    record(
      "live: initialize — protocol 2025-11-25 negotiated, serverInfo present",
      protocolOk ? "PASS" : "FAIL",
      `protocolVersion=${initResult?.protocolVersion} serverInfo=${JSON.stringify(initResult?.serverInfo)}`
    );

    // Quick tools/list sanity
    const tools = await listTools(transport);
    record("live: tools/list 10 tools", tools.length === 10 ? "PASS" : "FAIL", `count=${tools.length}`);

    // 1. Legacy ID with subreddit hint, carrying the explicit options
    //    (comment_sort=new, comment_limit=1) so options behavior is asserted
    //    inside the bounded 3-call budget.
    const legacyResult = await callTool(transport, "get_post", {
      postId: FIXTURE_POST_ID,
      subreddit: FIXTURE_SUBREDDIT,
      comment_sort: LIVE_COMMENT_SORT,
      comment_limit: LIVE_COMMENT_LIMIT,
    });
    const legacyBody = parseResultBody(legacyResult) as {
      id?: string;
      subreddit?: string;
      title?: string;
      body?: string;
      comments?: unknown[];
    };
    const legacyOk =
      legacyResult.isError !== true &&
      legacyBody.id === FIXTURE_POST_ID &&
      legacyBody.subreddit === FIXTURE_SUBREDDIT &&
      typeof legacyBody.title === "string" &&
      legacyBody.title.length > 0 &&
      Array.isArray(legacyBody.comments) &&
      legacyBody.comments.length <= LIVE_COMMENT_LIMIT;
    record(
      `live: legacy ID + subreddit (comment_sort=${LIVE_COMMENT_SORT}, comment_limit=${LIVE_COMMENT_LIMIT}) → id/subreddit ok, ≤${LIVE_COMMENT_LIMIT} comment returned`,
      legacyOk ? "PASS" : "FAIL",
      `isError=${legacyResult.isError} id=${legacyBody.id} subreddit=${legacyBody.subreddit} title="${(legacyBody.title ?? "").slice(0, 60)}" comments=${(legacyBody.comments ?? []).length}`
    );

    // 2. Full share URL (no subreddit hint)
    const urlResult = await callTool(transport, "get_post", {
      postId: `https://www.reddit.com/r/${FIXTURE_SUBREDDIT}/s/${FIXTURE_SHARE_TOKEN}`,
    });
    const urlBody = parseResultBody(urlResult) as { id?: string; subreddit?: string; title?: string; body?: string };
    const urlOk =
      urlResult.isError !== true &&
      urlBody.id === FIXTURE_POST_ID &&
      urlBody.subreddit === FIXTURE_SUBREDDIT &&
      typeof urlBody.title === "string" &&
      urlBody.title.length > 0;
    record(
      "live: full share URL → id=1x7hpcl, subreddit=webscraping, non-empty title",
      urlOk ? "PASS" : "FAIL",
      `isError=${urlResult.isError} id=${urlBody.id} subreddit=${urlBody.subreddit} title="${(urlBody.title ?? "").slice(0, 60)}"`
    );

    // 3. Bare share fragment with subreddit hint
    const fragResult = await callTool(transport, "get_post", {
      postId: `s/${FIXTURE_SHARE_TOKEN}`,
      subreddit: FIXTURE_SUBREDDIT,
    });
    const fragBody = parseResultBody(fragResult) as { id?: string; subreddit?: string; title?: string; body?: string };
    const fragOk =
      fragResult.isError !== true &&
      fragBody.id === FIXTURE_POST_ID &&
      fragBody.subreddit === FIXTURE_SUBREDDIT &&
      typeof fragBody.title === "string" &&
      fragBody.title.length > 0;
    record(
      "live: bare share fragment + hint → id=1x7hpcl, subreddit=webscraping, non-empty title",
      fragOk ? "PASS" : "FAIL",
      `isError=${fragResult.isError} id=${fragBody.id} subreddit=${fragBody.subreddit} title="${(fragBody.title ?? "").slice(0, 60)}"`
    );

    // 4. Cross-form equality — every title must EQUAL the legacy title (and be
    //    non-empty), and the bodies must match across all three forms.
    const forms = [
      { label: "legacy", body: legacyBody },
      { label: "share-url", body: urlBody },
      { label: "fragment", body: fragBody },
    ];
    const equalityOk =
      legacyBody.title !== undefined &&
      forms.every(
        (f) =>
          f.body.id === FIXTURE_POST_ID &&
          f.body.subreddit === FIXTURE_SUBREDDIT &&
          typeof f.body.title === "string" &&
          f.body.title.length > 0 &&
          f.body.title === legacyBody.title &&
          f.body.body === legacyBody.body
      );
    record(
      "live: all 3 forms → id=1x7hpcl, subreddit=webscraping, identical non-empty title and body",
      equalityOk ? "PASS" : "FAIL",
      `titleEqual=${forms.every((f) => f.body.title === legacyBody.title)} bodyEqual=${forms.every((f) => f.body.body === legacyBody.body)} titles=[${forms.map((f) => `"${(f.body.title ?? "").slice(0, 40)}"`).join(" | ")}]`
    );

    // 5. Exact repo URL — each of the 3 actual body strings must include it.
    const repoOk = forms.every(
      (f) => typeof f.body.body === "string" && f.body.body.includes(FIXTURE_REPO_URL)
    );
    record(
      `live: each of 3 bodies includes exact repo URL ${FIXTURE_REPO_URL}`,
      repoOk ? "PASS" : "FAIL",
      `perForm=${forms.map((f) => `${f.label}:${typeof f.body.body === "string" && f.body.body.includes(FIXTURE_REPO_URL)}`).join(", ")}`
    );
  } finally {
    await transport.close();
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const liveFlag = args.includes("--live");
  const mockFlag = args.includes("--mock");

  const usage =
    "Usage: tsx tests/mcp-smoke.ts [--mock|--live]  (default: --mock; REDLIB_URL configures the live target)";

  // Reject conflicting or unknown args BEFORE any spawn or network activity.
  if (liveFlag && mockFlag) {
    console.error("Conflicting flags: --mock and --live cannot be combined.");
    console.error(usage);
    process.exit(2);
  }
  const unknown = args.filter((a) => a !== "--live" && a !== "--mock");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}`);
    console.error(usage);
    process.exit(2);
  }

  const mode = liveFlag ? "live" : "mock";
  const redlibUrl = process.env.REDLIB_URL || DEFAULT_LIVE_URL;
  console.log(`MCP smoke harness — mode: ${mode}, protocol: ${PROTOCOL_VERSION}`);

  // Overall deadline: on expiry, run the SAME awaited cleanup the finally
  // blocks use, then exit — never an unawaited kill.
  const overallTimer = setTimeout(() => {
    console.error("FATAL: overall deadline exceeded — awaited cleanup, then exit 3");
    void emergencyShutdown().then(() => process.exit(3));
  }, OVERALL_DEADLINE_MS);
  overallTimer.unref();

  let exitCode = 0;
  try {
    if (mode === "mock") {
      await runMockMode();
    } else {
      await runLiveMode(redlibUrl);
    }
  } catch (err) {
    console.error(`\nHarness error: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  }

  clearTimeout(overallTimer);
  await emergencyShutdown(); // idempotent: no-op once the run closed its resources

  // Summary
  const passed = ledger.filter((r) => r.status === "PASS").length;
  const failed = ledger.filter((r) => r.status === "FAIL").length;
  const blocked = ledger.filter((r) => r.status === "BLOCKED").length;
  console.log(`\n── Summary: ${passed} passed, ${failed} failed, ${blocked} blocked ──`);

  if (failed > 0) {
    console.error("FAILURES:");
    for (const r of ledger.filter((x) => x.status === "FAIL")) {
      console.error(`  - ${r.name}: ${r.detail}`);
    }
    exitCode = 1;
  } else if (blocked > 0) {
    console.error("BLOCKED (upstream unavailable, no failures):");
    for (const r of ledger.filter((x) => x.status === "BLOCKED")) {
      console.error(`  - ${r.name}: ${r.detail}`);
    }
    exitCode = 4;
  }

  process.exit(exitCode);
}

void main();
