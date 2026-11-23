// Token Radar — entrypoint (main.ts). Node 22, standard library only.
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// model in lib/model.ts, and writes the entry's output directory:
//
//   /output/board.json       { rows: [...] } — the 100-row ranked board
//   /output/data.js          window.RADAR = {...}; — the dashboard's data,
//                             single source of truth, written from the
//                             same RadarResult as board.json
//   /output/dashboard/      copy of this repository's dashboard/
//   /output/screenshots/     copy of screenshots/ when it exists
//   /output/dossier.json     buildDossier from vendor/makefun-board.ts
//
// The dashboard page (dashboard/index.html) loads ../data.js, so the
// page is served with /output as the web root (or opened as a file under
// it): /output/dashboard/index.html reads /output/data.js. Do not serve
// dashboard/ on its own — its data file lives one level up.
//
// Layout of a run, outside the grader's container:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//
// In the grader the snapshot is /input/snapshot.json and the output is
// /output; both are the defaults here. The program is deterministic:
// two runs over the same snapshot write byte-identical files (no clock,
// no randomness, no environment-dependent output).
//
// Screenshots: buildDossier refuses an empty screenshots/ directory, so
// when this repository has no screenshots yet the program warns on
// stderr, skips dossier.json, and still exits 0 with board.json,
// data.js and dashboard/ written. That is the expected state before
// Worker 5 takes the screenshots — the screenshots gate is reported
// PENDING then, never faked. Once screenshots/ exists, the dossier is
// written and the run is complete.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRadar, dataScript, parseSnapshot, type BoardRow } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

/** The scorer's own caps (competition.yaml reference/gate.json). */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524_288; // 512 KiB
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304; // 4 MiB

const BOARD_MIN_ROWS = 100;
const BOARD_MAX_ROWS = 4_000;
const IMPLIED_MAX_USD = 100_000_000_000_000;

/** `--name <value>` or `--name=<value>` out of the arguments, else fallback. */
function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1] as string;
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined
    ? fallback
    : withEquals.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/**
 * The board the gate accepts, checked before anything is written: the
 * right number of rows, ranks exactly 1..N, implied values whole,
 * positive, capped and non-increasing with rank (not all equal), every
 * watchlist slug covered, and farm steps of 3–12 strings of 20–600
 * characters. A model that broke one of these must fail loudly here,
 * not hand the scorer a board it refuses.
 */
function checkBoard(board: BoardRow[], watchlist: string[]): string | null {
  if (board.length < BOARD_MIN_ROWS || board.length > BOARD_MAX_ROWS) {
    return `board holds ${board.length} rows, the gate takes ${BOARD_MIN_ROWS}–${BOARD_MAX_ROWS}`;
  }
  const seen = new Set<string>();
  let previous: number | null = null;
  let allEqual = board.length > 1;
  for (let i = 0; i < board.length; i++) {
    const row = board[i] as BoardRow;
    if (row.rank !== i + 1) {
      return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    }
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    const v = row.implied_value_usd;
    if (!Number.isInteger(v) || v <= 0 || v > IMPLIED_MAX_USD) {
      return `row ${row.slug} has implied_value_usd ${v}`;
    }
    if (previous !== null) {
      if (v > previous) {
        return `implied value rises from rank ${i} ($${previous}) to rank ${i + 1} ($${v})`;
      }
      if (v !== previous) allEqual = false;
    }
    previous = v;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps?.length ?? 0} farm steps, the gate takes 3–12`;
    }
    for (const step of row.farm_steps) {
      const len = typeof step === "string" ? step.trim().length : 0;
      if (len < 20 || len > 600) {
        return `row ${row.slug} has a farm step of ${len} characters, the gate takes 20–600`;
      }
    }
  }
  if (allEqual) return "every implied value is the same: not a ranking";
  const missing = watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `watchlist slugs missing from the board: ${missing.join(", ")}`;
  }
  return null;
}

/**
 * Copy one directory tree's regular files into `to`, skipping names
 * that start with a dot, and return the copied relative paths. Any
 * previous copy at `to` is removed first, so a run never leaves stale
 * files behind.
 */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const path = join(dir, name);
      const target = join(to, rel, name);
      const st = statSync(path);
      if (st.isDirectory()) {
        mkdirSync(target, { recursive: true });
        walk(path, rel === "" ? name : `${rel}/${name}`);
      } else if (st.isFile()) {
        copyFileSync(path, target);
        copied.push(rel === "" ? name : `${rel}/${name}`);
      }
    }
  };
  walk(from, "");
  return copied.sort();
}

// ------------------------------------------------------------ run

const inputArg = arg("input", "/input");
const inputFile = inputArg.endsWith(".json")
  ? inputArg
  : join(inputArg, "snapshot.json");
if (!existsSync(inputFile)) {
  fail(
    `no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const out = arg("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const snapshotText = readFileSync(inputFile, "utf8");
const snapshot = parseSnapshot(snapshotText);
const radar = buildRadar(snapshot);
const boardIssue = checkBoard(radar.board, snapshot.watchlist);
if (boardIssue !== null) {
  fail(`the model wrote a board the gate refuses: ${boardIssue}`, 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "board.json"), `${JSON.stringify({ rows: radar.board })}\n`);
writeFileSync(join(out, "data.js"), dataScript(radar));

const dashboardFiles = copyTree(join(here, "dashboard"), join(out, "dashboard"));
if (dashboardFiles.length === 0) {
  fail("dashboard/ is empty: the page is part of the entry", 1);
}

const shotFiles = copyTree(join(here, "screenshots"), join(out, "screenshots"));
let dossierBytes: number | null = null;
if (shotFiles.length === 0) {
  // No screenshots yet (Worker 5's job): buildDossier refuses an empty
  // screenshots/ directory, so there is no dossier to write. Warn and
  // keep going — board.json, data.js and dashboard/ are still valid —
  // and drop any stale dossier from an earlier run, so /output never
  // claims a dossier that does not match its screenshots.
  rmSync(join(out, "dossier.json"), { force: true });
  rmSync(join(out, "screenshots"), { recursive: true, force: true });
  process.stderr.write(
    "token radar: WARNING — screenshots/ is empty, dossier.json skipped " +
      "(screenshots gate PENDING until Worker 5 takes the 3 screenshots)\n",
  );
} else {
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
  });
  writeFileSync(join(out, "dossier.json"), dossier);
  dossierBytes = dossier.length;
}

process.stdout.write(
  `token radar: ${radar.stats.total_protocols} protocols, ${radar.stats.watchlist_total} on the watchlist, ` +
    `${radar.board.length} rows (${radar.stats.early_in_board} early, ${radar.live.length} live set aside)\n` +
    `token radar: wrote ${join(out, "board.json")}, ${join(out, "data.js")}, ` +
    `${join(out, "dashboard")} (${dashboardFiles.length} files), ` +
    `${join(out, "screenshots")} (${shotFiles.length} images)` +
    (dossierBytes === null
      ? " — dossier.json SKIPPED (no screenshots yet)\n"
      : `, ${join(out, "dossier.json")} (${dossierBytes} bytes)\n`),
);
