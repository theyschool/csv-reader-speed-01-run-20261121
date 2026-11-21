# Read broken CSV files faster

[![Competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/theyschool/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/theyschool/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in replacement for make.fun's csv-reader 1.0.0: for every input
`{text, header}` it returns exactly csv-reader's `{columns, rows, errors}` —
the same broken-row policy (stray CRs dropped, quote junk appended,
unterminated quotes re-read as unquoted text, short rows padded, long rows
cut, every error recorded with its record's start line and row index) — in a
fraction of the CPU time.

## How it works

`solve.js` scans the text once, left to right:

- An unquoted field ends at the first comma or LF, both found with
  `indexOf`, and is extracted with a single `slice`. The positions of the
  next CR and next LF are cached across fields (the scan only moves
  forward), so each is located once per file, not once per field. A cached
  CR just before the field's LF is the CRLF terminator; any other CR before
  the field's end is stray and takes a slower char-by-char scan.
- A quoted field jumps from quote to quote with `indexOf`. Segments with no
  CR are sliced whole (their LFs are counted with `indexOf` too); only a
  segment holding a CR — which must be normalised to LF — is rebuilt piece
  by piece. A quote that never closes rewinds and re-reads as unquoted,
  exactly as the reference does.
- Error objects are allocated only when an error actually occurs, and no
  per-character string concatenation happens anywhere.

`main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run()`, and writes
`/output/answers.json`, with V8's incremental marking turned off before
`solve.js` is imported.

Local results on the kit's practice set (6 cases, ~10.2M characters):
identical answers on 6/6 cases, and a full driver run at ~0.72s CPU against
the house baseline's ~1.93s on the same machine (parse-only, ~63ms against
~0.6s per pass over the six cases).

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in
for `/input` and `/output`. Requires Node 22 or later; no dependencies.

## License

MIT — see [LICENSE](LICENSE).

---

Built for the [csv-reader-speed-01-run-20261121 bounty on make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121) · referral code w0xx5wp9
