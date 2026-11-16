# md-core bench

Speed and output parity for `@affordances/md`'s single-pass converter, `packages/md/src/convert/core`. Run everything from `packages/md-core`.

| command                | what it does                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `node bench/fetch.ts`  | downloads the pages in `corpus/urls.txt` into `corpus/.cache/` (skips cached files; `--force` refetches) |
| `node bench/run.ts`    | speed: every tool on every page, median of n runs                                                        |
| `node bench/parity.ts` | output: `@affordances/md` by default (md-core) against its tree pipeline, the reference                  |

## Corpus

The real pages in `corpus/.cache/` (8 docs pages, ~3.7 MB) plus two synthetic docs-like pages from
`corpus/synthetic.mjs` (`synthetic/50` and `synthetic/200`, by section count). Page names are short:
the site and the last path segment, e.g. `react/useEffect`.

## run.ts

```
node bench/run.ts                          # all tools, all pages (~35 s, most of it the slow tools)
node bench/run.ts --tool core,mdream       # the quick loop: comma-separated substrings
node bench/run.ts --page react             # one page
node bench/run.ts --save before            # store the run in .results/before.json
node bench/run.ts --compare before         # print deltas against it
node bench/run.ts --json                   # machine-readable, nothing else on stdout
```

Other flags: `--runs` (timed runs per page, default 20), `--warmup` (default 3), `--budget` (ms a
slow tool may spend on one page before it stops at 3 runs, default 1000), `--no-gc`, and `--commit <sha>`, which
records the commit measured in the json (the bench may run on an export with no git). The json also records the
1-minute load as the run starts and each tool's installed version.

Tools: md-core, `@affordances/md`, the last published `@affordances/md` from npm (a devDependency, `@affordances/md-published`, so it installs with the rest), mdream, turndown with the gfm plugin, node-html-markdown. When
`packages/md/src/convert/core/parse.ts` (`parse(html)`) and `emit.ts` (`emit(doc, options)`) exist, `md-core parse` and
`md-core emit` time the two stages alone; emit runs on a tree parsed outside the clock.

Reading the output:

- the first table is the median ms per page; with `--compare`, each cell has its change in brackets
- `total ms` is the sum of the page medians; `MB/s` is HTML bytes in over that time
- `out KB` is the markdown produced; it differs a lot between tools, which is why only speed is compared
- `spread` is half the interquartile range, summed over pages, as a share of the total: a rough ± for
  the total. A few percent is normal; more means the machine was busy, so rerun
- `runs` is the range of timed runs per page; slow tools stop early (see `--budget`)
- the last lines are md-core's total over mdream's on the same pages, then both totals without
  `synthetic/200`, which is nearly half of md-core's time

How it measures: one untimed pass over the corpus warms the jit. Then, page by page, each tool gets
a full gc, its warm-up runs and its timed runs back to back, so it's timed in its own steady state
and pays only for its own garbage. The tool order rotates from page to page. Every output feeds a
sink that's read at the end, so no tool can be optimised away. A tool that throws on a page is
recorded as an error and the rest carry on; a tool that throws `not implemented…` is shown as such.

## parity.ts

```
node bench/parity.ts                  # table and overall score
node bench/parity.ts --diff react     # unified diff for that page (first 40 hunks; --hunks n)
node bench/parity.ts --write          # both outputs to .results/parity/<page>.{reference,core}.md
```

Both converters get `{ url: 'https://site.test/a' }`. `exact` is a byte-for-byte match of the
markdown. `lines kept` is the share of the reference's lines md-core reproduces in order (a line
LCS), rounded down so only an exact page shows 100.0%. `notes` flags a differing `title` or `url`.
The overall score weights pages by their line count.

## Caveats

- The real pages are third-party and not committed (`corpus/.cache/` is gitignored); `fetch.ts`
  gets them again, but the sites change, so numbers from different fetches don't compare.
- The tools aren't feature-equivalent: they extract different content and write different markdown.
  This compares speed, not quality; parity against `@affordances/md` is the quality check.
- The pages are converted from one string each in a warm process: startup, module loading and
  first-call jit cost are excluded.
- Slow tools (`@affordances/md`, turndown, node-html-markdown) get only 3–10 runs a page, and their
  totals move by up to ~10% between runs. The fast tools get all 20 and repeat to about 1%.
- A busy machine (other agents, builds) moves everything; compare runs made back to back.
