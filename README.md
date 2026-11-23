[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rahmatjibran04-byte/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rahmatjibran04-byte/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar: a dashboard that ranks pre-token DeFi protocols by
**implied value** — what a protocol's token would be worth if its record
stayed as it is — and shows a reader how to farm each one before (or after)
it issues a token. Built for the
[make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).

The board reads a sealed DefiLlama snapshot (758 protocols at or above
$5,000,000 TVL, fetched 2026-11-14) and ranks **100 protocols**: the full
40-protocol watchlist of protocols that record no token, plus 60 early
protocols below the $50,000,000 floor that the radar exists to find early.
Protocols whose token already trades are set aside in a separate live list —
never ranked as pre-token. The implied value is this entry's own claim,
never make.fun's; and a protocol is described as recording no token, never
as having none, because DefiLlama's record is not proof.

## The board at a glance

| | |
|---|---|
| Board rows | 100 (40 watchlist + 60 early) |
| Total implied value | $2,770,443,394 |
| Median implied value | $9,951,695 |
| Top of the board | Steakhouse Financial — $416,994,969 |
| Bottom of the board | Hakutora — $4,578,858 |
| Top 5 share of the board | 45.6% |
| Live rows set aside | 20 (top by market cap; Rain leads at $2.65B) |
| Farm plan | 6–7 concrete steps per protocol, each naming cost, duration and the exact action |

## The value model

Every pre-token protocol gets one number, derived only from the snapshot's
own figures — its TVL, its seven-day growth, and how long it has run with
no token:

```
implied = 4.11 × TVL^0.85 × growth × age × chain × category
```

| Factor | Formula | Effective range |
|---|---|---|
| TVL | `4.11 × TVL^0.85` | sub-linear: the board's top row is 15.1% of the board's total implied value |
| Growth | `1 + 0.0075 × clamp(change_7d, −60, +120)`, then clamped to `[0.55, 1.90]`; null → `1.00` | 0.55–1.90 |
| Age | `0.55 + 0.45 × (1 − exp(−age/400))`; protocols older than 730 days are discounted up to 10% over the next 1,095 days | 0.598 (45 days) – 0.927 (730 days, peak) |
| Chain | `1 + 0.04 × min(chains − 1, 5)` | 1.00–1.20 |
| Category | `clamp(1.06 − 0.9 × category share of the strict-rankable pool, 0.92, 1.08)` | 0.92 (Risk Curators, 17.2% share) – 1.08 (rare categories) |
| Age null | treated as 365 days → factor 0.819 | 2 watchlist members (Lightning Network, Noble) |

No hardcoded list of names: the same formula scores any protocol the
snapshot holds, so a future snapshot re-ranks the field from its own
figures. The sub-linear TVL exponent (0.85) keeps the board from becoming
a TVL table — the largest protocol does not swallow the ranking — while
growth, age, chain count and category concentration still move a protocol
up or down.

### Calibration of K = 4.11

The constant is calibrated to a live-token anchor, not chosen by hand.
Among snapshot protocols with a traded token, the median market-cap/TVL
ratio is **0.214** (n = 128). Applied to the watchlist's median TVL of
$152,788,602, that anchor implies a median implied value of **$32,666,701**.
K = 4.11 is the constant that lands the model's watchlist median on that
anchor: the model produces a median implied value of **$32,698,975**,
**0.10%** from the target.

## The dashboard

`dashboard/` is a dependency-free page (plain HTML, CSS and JavaScript,
no network calls) that renders from the data the program writes:

- **Board** — all 100 protocols ranked by implied value, sortable columns,
  with TVL, 7-day change, age, category and chain count beside each value.
- **Detail view** — click any row for the protocol's full breakdown: every
  model factor with its number, the implied-value build-up, and its farm plan.
- **Filter** — filter by section (watchlist / early), category, chain, and
  free-text search, so a reader can narrow the board to what they can farm.
- **Live list** — the 20 largest protocols whose token already trades,
  shown separately with market cap and mcap/TVL, so the pre-token board is
  never mixed with live tokens.
- **Farm plans** — every row carries 6–7 concrete steps (3–12 allowed, each
  20–600 characters) naming what it costs, how long it takes, and the exact
  action for that protocol's category, chains, TVL and age.

## Running it

Node.js 22.18 or later, standard library only — nothing is installed
before it runs.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

In the grader the snapshot is `/input/snapshot.json` and the output is
`/output`; both are the defaults. The program is deterministic: two runs
over the same snapshot write byte-identical files (no clock, no randomness,
no environment-dependent output).

Each run writes:

| Output | Contents |
|---|---|
| `board.json` | `{ rows: [...] }` — the 100-row ranked board |
| `data.js` | `window.RADAR = {...}` — the dashboard's data, written from the same result as `board.json` |
| `dashboard/` | Copy of this repository's `dashboard/` |
| `screenshots/` | Copy of `screenshots/` (3 PNGs of the dashboard) |
| `dossier.json` | Built by `buildDossier` from `vendor/makefun-board.ts` — the dashboard's source text plus its screenshots, exactly as the scorer reads it |

## Repository layout

```
main.ts                  Entry point: reads the snapshot, scores, writes /output
lib/model.ts             The model: parseSnapshot, buildRadar, dataScript
dashboard/
  index.html             The page
  app.js                 Board, detail view, filters
  app.css                The page's styling
screenshots/
  01-board.png           The board view (1440×900)
  02-detail-steakhouse-financial.png   A protocol's detail view (1440×900)
  03-filtered-risk-curators.png        A filtered view (1440×900)
vendor/
  makefun-board.ts       The kit's dossier library (byte for byte the scorer's copy)
package.json             { "name": "token-radar-01", "private": true, "type": "module" }
.makefun/owner.json      Claim file naming the entrant's wallet
LICENSE                  MIT
```

## Validation

All seven of the competition's gate rows pass on a local run over the
sealed snapshot (checked with the kit's own gate shape, plus integration
checks — 11 checks, 0 failures):

| Gate | Result |
|---|---|
| dashboard_files | PASS — 3 files, 32,530 bytes (`index.html` + 1 CSS + 1 JS), no `http(s)` URL anywhere |
| board_file | PASS — 100 rows, 195,498 bytes |
| sorted_by_value | PASS — ranks exactly 1–100, implied values strictly non-increasing, 100 unique values (top $416,994,969, bottom $4,578,858) |
| coverage | PASS — 40/40 watchlist slugs covered |
| farm_steps | PASS — every row 6–7 steps, each 20–600 characters |
| screenshots | PASS — 3 whole PNGs, each ≤ 512 KiB, long side ≤ 1440, short side ≥ 800 (total 608,076 bytes) |
| dossier_matches | PASS — byte-identical to `buildDossier`, 845,760 bytes ≤ 1.5 MiB |

The dashboard's source (32,530 bytes) fits whole inside the dossier's
65,536-byte text cap, so the judge reads every line of it. The model
itself is unit-tested (26 checks: 100 rows, 40 watchlist, unique ranks,
monotone values, early rows drawn from the strict ≥ $10M pool with no
leakage, farm-step lengths, live rows disjoint and ordered by market cap,
byte-identical determinism).

## Notes and limits

- The snapshot is sealed: every run of the entry and the grade reads the
  same bytes, fetched once from DefiLlama's public API on 2026-11-14. The
  board is a claim about that snapshot, not a live price feed.
- The entry does not predict whether or when a protocol issues a token.
- The dashboard renders with no network: it loads only its local `data.js`.

## License

MIT — see [LICENSE](LICENSE).
