/**
 * Regression group — the stdio smoke harness must never leave a live fixture
 * child behind when startup fails.
 *
 * Every case here runs the REAL candidate harness (`tests/mcp-smoke.ts`, via the
 * repo's installed tsx executable) inside an owned scratch directory whose
 * `dist/index.js` is a self-contained fixture child. The harness spawns
 * `dist/index.js` relative to its own cwd, so it always spawns OUR fixture —
 * never the candidate build — which keeps this group independent of any
 * pre-existing `dist/`. The test then observes, from the outside, whether the
 * exact fixture PID survives the harness run.
 *
 * The regression: on a JSON-RPC initialize error the harness used to drop the
 * only registry handle for the child before any cleanup ran, orphaning a child
 * that deliberately stays alive.
 *
 * The waits in this file (harness runtime, TERM→KILL rescue, PID polling) are
 * execution safety limits that keep a hung harness or a runaway fixture from
 * wedging the suite. They are not reviewer time budgets.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SMOKE_HARNESS = join(REPO_ROOT, "tests", "mcp-smoke.ts");

/** Bounded runtime for one real harness run (tsx startup + fixture + cleanup). */
const HARNESS_RUNTIME_LIMIT_MS = 15_000;
/** Bounded budget for the harness's own TERM→KILL escalation, asserted below. */
const ESCALATION_BUDGET_MS = 10_000;
/** Bounded rescue wait used only by this test's finally blocks. */
const RESCUE_WAIT_MS = 3_000;

const INITIALIZE_ERROR_CODE = -32603;
const INITIALIZE_ERROR_MESSAGE = "LIFECYCLE_INITIALIZE_FAILURE";
const TOOLS_LIST_CONTROL_CODE = -32042;
const TOOLS_LIST_CONTROL_MESSAGE = "LIFECYCLE_TOOLS_LIST_CONTROL";

/**
 * Per-test Jest bound, set explicitly on each case below (ESM module scope has
 * no `jest` global, so this is the ESM-safe equivalent of `jest.setTimeout`).
 * Plain `npm test` therefore uses the intended bound with no CLI flag.
 */
const TEST_TIMEOUT_MS = 30_000;

// ── fixture children ───────────────────────────────────────────────────────
//
// Written as CommonJS into `<scratch>/dist/index.js` next to a `dist/package.json`
// pinning `type: commonjs`, so the fixture is unaffected by any package.json
// further up the scratch tree. Each fixture records its own PID in `child.pid`
// (relative to its cwd, which the harness inherits) so the test can check the
// EXACT process rather than pattern-matching a process name.

const FIXTURE_PREAMBLE = `'use strict';
const fs = require('node:fs');
const readline = require('node:readline');
fs.writeFileSync('child.pid', String(process.pid));
const reply = (message) => { process.stdout.write(JSON.stringify(message) + '\\n'); };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  handle(message);
});
`;

const INITIALIZE_ERROR_REPLY = `reply({ jsonrpc: '2.0', id: message.id, error: { code: ${INITIALIZE_ERROR_CODE}, message: '${INITIALIZE_ERROR_MESSAGE}' } });`;

/** initialize → JSON-RPC error, then deliberately stays alive. */
const INITIALIZE_ERROR_FIXTURE = `${FIXTURE_PREAMBLE}
function handle(message) {
  if (message.method === 'initialize') {
    ${INITIALIZE_ERROR_REPLY}
  }
}
setInterval(() => {}, 1000); // deliberately remain alive after the error
`;

/** Same, but SIGTERM is ignored so only SIGKILL escalation can end it. */
const INITIALIZE_ERROR_IGNORES_SIGTERM_FIXTURE = `${FIXTURE_PREAMBLE}
process.on('SIGTERM', () => { /* deliberately ignored */ });
function handle(message) {
  if (message.method === 'initialize') {
    ${INITIALIZE_ERROR_REPLY}
  }
}
setInterval(() => {}, 1000);
`;

/** initialize → JSON-RPC error, then exits immediately (exit-race control). */
const INITIALIZE_ERROR_EXITS_IMMEDIATELY_FIXTURE = `${FIXTURE_PREAMBLE}
function handle(message) {
  if (message.method === 'initialize') {
    ${INITIALIZE_ERROR_REPLY}
    process.exit(0);
  }
}
`;

/**
 * Successful-handshake control: initialize succeeds with the correct protocol
 * and serverInfo, then tools/list fails with its own distinct code while the
 * child stays alive. The harness must reach initialize PASS and clean the child
 * up through the initialized transport's finally.
 */
const TOOLS_LIST_ERROR_CONTROL_FIXTURE = `${FIXTURE_PREAMBLE}
function handle(message) {
  if (message.method === 'initialize') {
    reply({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'lifecycle-control-fixture', version: '1.0.0' },
      },
    });
  } else if (message.method === 'tools/list') {
    reply({ jsonrpc: '2.0', id: message.id, error: { code: ${TOOLS_LIST_CONTROL_CODE}, message: '${TOOLS_LIST_CONTROL_MESSAGE}' } });
  }
}
setInterval(() => {}, 1000);
`;

// ── helpers ────────────────────────────────────────────────────────────────

const SCRATCH_ROOT =
  process.env.TMPDIR && process.env.TMPDIR.length > 0 ? process.env.TMPDIR : tmpdir();

function createFixtureWorkspace(fixtureSource: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH_ROOT, "mcp-smoke-lifecycle-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
  writeFileSync(join(dir, "dist", "index.js"), fixtureSource);
  return dir;
}

function removeFixtureWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** The fixture's own PID, as recorded by the fixture at startup. */
function readFixturePid(dir: string): number | undefined {
  const pidPath = join(dir, "child.pid");
  if (!existsSync(pidPath)) return undefined;
  const pid = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Portable liveness check. `kill(pid, 0)` alone is not enough on Linux: an
 * already-reaped-by-nobody zombie still accepts signal 0, so the /proc state is
 * consulted there to avoid counting a dead child as a live process. On other
 * platforms the signal-0 probe is the check.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // ESRCH (or EPERM, which we also treat as not ours to observe)
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const endOfName = stat.lastIndexOf(")");
      const state = stat.slice(endOfName + 2, endOfName + 3);
      if (state === "Z" || state === "X") return false;
    } catch {
      return false; // vanished between the probe and the read
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Terminate ONE owned PID (TERM, then KILL) and wait for it to be gone. Used
 * only by this test's finally blocks so a failed assertion cannot leak a
 * fixture. Never matches by name or scans for processes.
 */
async function rescueOwnedProcess(pid: number | undefined): Promise<void> {
  if (pid === undefined || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const termDeadline = Date.now() + RESCUE_WAIT_MS;
  while (Date.now() < termDeadline && isProcessAlive(pid)) await delay(50);
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  const killDeadline = Date.now() + RESCUE_WAIT_MS;
  while (Date.now() < killDeadline && isProcessAlive(pid)) await delay(50);
}

interface HarnessRun {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Spawn the real candidate harness in `cwd` with --mock, bounded in time. */
function runCandidateHarness(cwd: string): Promise<HarnessRun> {
  return new Promise<HarnessRun>((resolveRun, rejectRun) => {
    const started = Date.now();
    const child: ChildProcess = spawn(TSX_BIN, [SMOKE_HARNESS, "--mock"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      settle();
    };

    child.stdout!.setEncoding("utf-8");
    child.stdout!.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr!.setEncoding("utf-8");
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
    });

    timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGKILL");
        rejectRun(
          new Error(
            `candidate smoke harness exceeded ${HARNESS_RUNTIME_LIMIT_MS}ms in ${cwd}\n` +
              `stdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
      });
    }, HARNESS_RUNTIME_LIMIT_MS);

    child.once("error", (err) => {
      finish(() => rejectRun(new Error(`failed to spawn candidate smoke harness: ${err.message}`)));
    });

    // "close" (not "exit") so stdout/stderr are fully drained before we read.
    child.once("close", (code, signal) => {
      finish(() =>
        resolveRun({ exitCode: code, signal, stdout, stderr, durationMs: Date.now() - started })
      );
    });
  });
}

// ── the lifecycle group ────────────────────────────────────────────────────

describe("mcp-smoke harness child lifecycle (real process)", () => {
  it("terminates its exact fixture child when initialize returns a JSON-RPC error", async () => {
    const dir = createFixtureWorkspace(INITIALIZE_ERROR_FIXTURE);
    let fixturePid: number | undefined;
    try {
      const run = await runCandidateHarness(dir);
      // Capture liveness BEFORE any rescue can run.
      fixturePid = readFixturePid(dir);
      const aliveAfterHarnessExit = fixturePid !== undefined && isProcessAlive(fixturePid);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(
        `JSON-RPC error ${INITIALIZE_ERROR_CODE}: ${INITIALIZE_ERROR_MESSAGE}`
      );
      expect(fixturePid).toBeDefined();
      expect(aliveAfterHarnessExit).toBe(false);
    } finally {
      await rescueOwnedProcess(fixturePid ?? readFixturePid(dir));
      removeFixtureWorkspace(dir);
    }
  }, TEST_TIMEOUT_MS);

  it("escalates TERM to KILL for a fixture that ignores SIGTERM", async () => {
    const dir = createFixtureWorkspace(INITIALIZE_ERROR_IGNORES_SIGTERM_FIXTURE);
    let fixturePid: number | undefined;
    try {
      const run = await runCandidateHarness(dir);
      fixturePid = readFixturePid(dir);
      const aliveAfterHarnessExit = fixturePid !== undefined && isProcessAlive(fixturePid);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(
        `JSON-RPC error ${INITIALIZE_ERROR_CODE}: ${INITIALIZE_ERROR_MESSAGE}`
      );
      expect(fixturePid).toBeDefined();
      expect(aliveAfterHarnessExit).toBe(false);
      // The SIGKILL escalation is bounded, not open-ended.
      expect(run.durationMs).toBeLessThan(ESCALATION_BUDGET_MS);
    } finally {
      await rescueOwnedProcess(fixturePid ?? readFixturePid(dir));
      removeFixtureWorkspace(dir);
    }
  }, TEST_TIMEOUT_MS);

  it("cannot hang when the fixture exits immediately after its initialization error", async () => {
    const dir = createFixtureWorkspace(INITIALIZE_ERROR_EXITS_IMMEDIATELY_FIXTURE);
    let fixturePid: number | undefined;
    try {
      const run = await runCandidateHarness(dir);
      fixturePid = readFixturePid(dir);
      const aliveAfterHarnessExit = fixturePid !== undefined && isProcessAlive(fixturePid);

      expect(run.exitCode).toBe(1);
      // Either the initialize error or the exit race may settle first; both are
      // honest startup-failure diagnostics and neither may hang.
      expect(run.stderr).toMatch(
        new RegExp(
          `Harness error: (JSON-RPC error ${INITIALIZE_ERROR_CODE}: ${INITIALIZE_ERROR_MESSAGE}|Child exited before ready)`
        )
      );
      expect(fixturePid).toBeDefined();
      expect(aliveAfterHarnessExit).toBe(false);
      expect(run.durationMs).toBeLessThan(ESCALATION_BUDGET_MS);
    } finally {
      await rescueOwnedProcess(fixturePid ?? readFixturePid(dir));
      removeFixtureWorkspace(dir);
    }
  }, TEST_TIMEOUT_MS);

  it("cleans up its exact child through the initialized transport when tools/list fails", async () => {
    const dir = createFixtureWorkspace(TOOLS_LIST_ERROR_CONTROL_FIXTURE);
    let fixturePid: number | undefined;
    try {
      const run = await runCandidateHarness(dir);
      fixturePid = readFixturePid(dir);
      const aliveAfterHarnessExit = fixturePid !== undefined && isProcessAlive(fixturePid);

      // Successful startup is reached (handshake ordering intact) ...
      expect(run.stdout).toContain(
        "[PASS] initialize: protocol 2025-11-25 negotiated, serverInfo present"
      );
      // ... and the run then fails on the fixture's tools/list error, with that
      // exact code/message and not the initialize error.
      expect(run.stderr).toContain(
        `JSON-RPC error ${TOOLS_LIST_CONTROL_CODE}: ${TOOLS_LIST_CONTROL_MESSAGE}`
      );
      // The tools/list control code is distinct from the initialize error code.
      expect(run.stderr).not.toContain(`${INITIALIZE_ERROR_CODE}`);
      expect(run.exitCode).toBe(1);
      expect(fixturePid).toBeDefined();
      expect(aliveAfterHarnessExit).toBe(false);
    } finally {
      await rescueOwnedProcess(fixturePid ?? readFixturePid(dir));
      removeFixtureWorkspace(dir);
    }
  }, TEST_TIMEOUT_MS);
});
