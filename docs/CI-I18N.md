# Language smoke shards

`npm run smoke:i18n` still runs the full web smoke. Select a deterministic subset with `npm run smoke:i18n -- --languages de,es`. The same option works with `npm run smoke:i18n:embedded`. Unknown, empty and duplicate language selections fail before browser work starts. Selection order follows the full run: `en`, `de`, `es`, `ru`, `zh-CN`.

Each selected language retains its existing translation, layout, browser-error, lazy-loading, switching and persistence checks. The web smoke still checks that every other non-English bundle remains unloaded, including languages outside the selected shard. English owns the shared helper-route and review probes. The two NFT import screens exercised in both the zero-balance and success flows retain both scenarios in a single pair result.

## Coverage contract

`scripts/i18n-required-screens.json` remains the web coverage authority: 141 screens in each of five languages, or 705 pairs. `scripts/i18n-required-embedded-screens.json` records all 345 embedded pairs, including the existing German reconnect case, offline executable-request checks, startup language selection and native credential-timeout/backup-failure scenarios. Embedded keeps its existing offline screen set.

Each smoke writes a JSON report to `I18N_REPORT_PATH`, or to `smoke-results.json` in its screenshot output directory. A new run first writes a failed report and marks it passed only after its checks complete. `I18N_SCREENSHOT_DIR` still controls screenshots and the existing diagnostic JSON files.

CI uploads one report named `<language>.json` per shard, even after failures. The aggregate requires exactly five report files, the expected suite and language in each, a passed status, no reported problems, and every required pair exactly once. Missing files, malformed reports, unexpected or duplicate pairs, and incomplete results fail. The aggregate also requires the matrix job result to be `success`, so a failed, cancelled or skipped shard fails even if a report is present. Both matrices use `fail-fast: false` to collect results from all shards.

Version 2 reports require exactly `version`, `suite`, `languages`, `status`, `durationSeconds` and `results`. The suite and status are strings with known values, duration is a finite nonnegative number, and the language list must contain exactly the job's language, derived from its report filename. Each result requires exactly `language`, `screen`, `pass`, `fail`, `problems` and `scenarios`. Language and screen must be strings in the suite's required matrix; `pass` and `fail` must be boolean opposites. Passing coverage requires `pass: true`, `fail: false` and an empty problem list. Problem and scenario entries must be strings. Ordinary pairs have an empty scenario list; the shared NFT pairs retain their scenario labels. Unexpected and missing fields fail validation. Schema validation precedes coverage key construction, so arrays and objects cannot be coerced into valid pairs. Version 1 reports require a fresh smoke run.

Run the verifier with `node scripts/check-i18n-shards.mjs --suite web --directory <report-directory>`, or use `--suite embedded`. CI runs `node --test scripts/i18n-shards.test.mjs scripts/i18n-coverage.test.mjs` alongside the regular tests. Negative cases cover malformed field types, unknown languages/screens, missing and extra fields, non-boolean outcomes, failed pairs, missing shards, duplicates within and across shards, and reports containing another job's language.

## Workflow wiring

`language-smoke-shard` runs five web shards in parallel. Each builds its own production bundle so browser work can start independently of lint and unit tests. `language-smoke (22.22.x)` retains the existing job/check name and verifies the complete report collection.

The reusable `embedded-checks.yml` builds one self-contained document, checks its digest, and shares those exact bytes with five embedded language shards. Its final job verifies coverage and all dependency results before uploading `myqrlwallet-embedded`. CI calls this workflow for PRs and branch pushes. `embedded-build.yml` calls it for `embedded-v*` tags and retains the `embedded` and `release` job IDs, release assets, digest verification and provenance attestation. Branch and PR builds run the embedded workflow once.

The required check remains exactly `lint-and-build (22.22.x)`. It runs with `always()` and requires successful `lint-test-build`, `language-smoke` and `embedded` results. Docker still depends on this required check. The tag release still depends on embedded verification.

GitHub's [workflow artifact documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data) describes the bundle and report handoff between jobs.

## Playwright browser cache

The boot smoke in `lint-test-build`, all five web shards, and all five embedded shards call `.github/actions/setup-chromium` after `npm ci`. These are all browser-installing jobs in the workflows. The embedded tag workflow uses the same action through `embedded-checks.yml`. Job IDs, names, matrices, dependencies, coverage aggregates, the required `lint-and-build (22.22.x)` check, and release/Docker gating are unchanged by caching.

The composite action caches `~/.cache/ms-playwright` using `actions/cache` v4.3.0, pinned to `0057852bfaa89a56745cba8c7296529d2fc39830`. The key is `${runner.os}-${runner.arch}-playwright-${version}-chromium-headless-v1`, where `version` comes from `package-lock.json` at `packages["node_modules/playwright"].version`. The action checks that both installed `playwright` and `playwright-core` match it. The current key on the Linux x64 runners is `Linux-X64-playwright-1.61.0-chromium-headless-v1`. Playwright upgrades invalidate the cache; unrelated dependency updates retain it. There are no fallback restore keys. The suffix separates this browser selection from future configurations that require a full browser.

On an exact cache hit, the action reuses the browser binaries. On a miss, it runs `npx --no-install playwright install --only-shell chromium`; `actions/cache` saves the downloaded binaries after a successful job. The first successful job can populate the shared key. Concurrent cold jobs can each miss before a cache is saved. GitHub's normal branch/ref cache visibility still applies, so a new version or an inaccessible cache starts cold. The browser step logs `Chromium browser: cached` or `Chromium browser: downloaded`.

After browser and font preparation, the action runs `.github/actions/setup-chromium/check-launch.mjs`, which launches the installed headless Chromium and closes it. The launch timeout is 10 seconds, with a 15-second watchdog covering the entire launch/close check. A successful check logs `Chromium dependencies: present; skipping install-deps` and avoids apt entirely. A failed check logs the fallback, runs `npx --no-install playwright install-deps chromium` once, and repeats the same check. Successful recovery logs `Chromium dependencies: installed; launch check passed`. An installer failure or a second failed check fails the step with an explicit error. Browser preparation, font provisioning and dependency checking have separate step timings.

All three CI smoke entry points use `chromium.launch()` with its default headless mode and no channel override. Installing only the headless shell preserves the browser they already execute, retains FFmpeg, and avoids downloading unused full Chromium. The existing `smoke:approvals` script uses the full Chromium channel and currently has no workflow caller; a future CI caller needs its own full-browser cache selection. See [Playwright's headless-shell installation guidance](https://playwright.dev/docs/browsers#chromium-headless-shell).

System libraries remain runner-local. GitHub's [Ubuntu runner image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#browsers-and-drivers) includes Google Chrome, so its existing libraries can satisfy the headless shell. The launch check determines whether each runner can start the locked browser. The fallback uses Playwright's Chromium-specific library/font package group. See [Playwright's cache guidance](https://playwright.dev/docs/ci#caching-browsers) and the [pinned cache action](https://github.com/actions/cache/tree/0057852bfaa89a56745cba8c7296529d2fc39830).

## Language fonts and glyph checks

Font provisioning runs on every setup action invocation, independently of Chromium's launch result. `fonts.lock` pins architecture-independent Ubuntu packages `fonts-noto-cjk` version `1:20230817+repack1-3` and `fonts-dejavu-core` version `2.37-8`, including their public archive URLs and SHA-256 checksums. Noto supplies Chinese glyphs; DejaVu supplies Latin, accented Latin and Cyrillic. The font cache key includes the runner OS, architecture and hash of the complete lockfile, with no fallback restore keys. Package/version or checksum changes invalidate it.

On a miss, `install-fonts.sh` downloads the pinned package archives. On a hit, it reuses them without network or apt work. Both paths verify each SHA-256 checksum and package/version metadata, extract the font files into the user's font directory, and run `fc-cache --force` for that directory. The installer uses `dpkg-deb` extraction and needs no elevated privileges. `I18N_FONT_PACKAGE_CACHE` selects the package cache; `I18N_FONT_INSTALL_DIR` can select an isolated font directory for local validation. Cache corruption fails the step. The action logs each exact package version and whether it was cached or downloaded.

Both web and embedded smoke entrypoints run `assertLanguageGlyphs` immediately after browser launch, before their first scenario. In the same headless browser, it renders each character of the selected language's sample into a canvas using sans-serif, system-ui and monospace fallbacks. It compares the pixels with noncharacter/unassigned-codepoint missing-glyph controls and rejects blank glyphs too. Samples include accented German/Spanish, every Russian letter including `Ё/ё`, and common Chinese wallet terms. This checks actual rasterization before taking layout measurements. A failure leaves the shard report failed and exits 1.

Run `node scripts/i18n-glyphs.mjs --languages zh-CN` for a standalone check, or omit the option to check all five languages. CI also runs `node --test scripts/i18n-glyphs.test.mjs` after Chromium/font setup. Its regression test restricts a fresh Chromium process to a DejaVu-only fontconfig: Latin and Cyrillic pass, and Chinese must exit 1 with a missing-glyph diagnostic. Local font isolation can use `FONTCONFIG_FILE` with only the desired `<dir>` entries and a writable `<cachedir>`; leave both display variables unset for headless checks.

## Measurements on 2026-10-23

The original smoke and build measurements below used `CI=true`, Node 22.22.3 and installed Chromium. Shards ran sequentially on the local machine to measure each duration; the parallel estimate uses the slowest shard. GitHub runner queue time, browser installation and artifact network transfer are additional costs.

| Language | Web smoke | Embedded smoke | Web build | Exit codes (web, embedded, build) |
| -------- | --------: | -------------: | --------: | --------------------------------- |
| en       |   210.5 s |         35.0 s |    29.8 s | 0, 0, 0                           |
| de       |    88.9 s |         36.5 s |    18.3 s | 0, 0, 0                           |
| es       |    89.0 s |         36.8 s |    17.0 s | 0, 0, 0                           |
| ru       |    89.8 s |         38.1 s |    17.0 s | 0, 0, 0                           |
| zh-CN    |    90.7 s |         34.9 s |    17.5 s | 0, 0, 0                           |

The web smoke's serial shard total was 568.9 seconds; parallel execution is estimated at 210.5 seconds plus job overhead. The embedded total was 181.4 seconds; parallel execution is estimated at 38.1 seconds plus its shared build and job overhead. Both aggregate coverage commands exited 0.

The unchanged full web command passed all 705 pairs in 588.8 seconds. Its smoke-only wall time therefore projects from 9m49s to 3m31s. The full embedded command passed all 345 pairs in 209.3 seconds, projecting from 3m29s to 38.1 seconds for the smoke portion. An earlier web run overlapped other heavy verification and hit the existing 600-second watchdog with exit 1; the isolated rerun above exited 0. The watchdog and all browser assertions remain unchanged.

### Build once versus build per shard

Five web production builds took 17.0-29.8 seconds, with a 17.5-second median. A local artifact round trip compressed the bundle to 6.05 MB in 0.377 seconds and extracted it in 0.083 seconds, with matching file digests. This measures archive work; GitHub upload/download latency was unavailable locally.

The measured cached `npm ci --legacy-peer-deps` took 9.7 seconds. Using those measured components, independent builds need about 27.2 seconds of preparation per shard. A dedicated shared-build job needs at least 37.4 seconds before a shard can start: producer install/build, archive work, then the consumer install. Additional runner setup and transfer latency favor the independent builds for elapsed time. Reusing `lint-test-build` would also make all smoke shards wait for that entire job. CI therefore builds the web bundle separately in each shard.

Embedded builds once so every shard and the published artifact use identical document bytes. Its local build took 41.6 seconds, and its 1.36 MB artifact took 0.155 seconds to archive and extract. The reduction from five serial language runs to the slowest shard exceeds the extra job overhead.

### Browser setup breakdown and expected timings

The latest successful [CI run on the base revision](https://github.com/DigitalGuards/myqrlwallet-frontend/actions/runs/39942189489) recorded `language-smoke` at 15m29s, including 8m50s of smoke and 5m55s installing Chromium. `lint-test-build` took 19m01s, including 9m45s installing Chromium. The corresponding [embedded run](https://github.com/DigitalGuards/myqrlwallet-frontend/actions/runs/39942189439) took 10m19s, including 2m53s of smoke and 6m37s installing Chromium.

The timestamped logs separate system-package work from browser downloads:

| Job               | System dependencies, including apt | Browser downloads and extraction | Unused full Chromium portion |
| ----------------- | ---------------------------------: | -------------------------------: | ---------------------------: |
| `lint-test-build` |                            576.5 s |                            8.4 s |                        4.0 s |
| `language-smoke`  |                            345.0 s |                            9.4 s |                        4.6 s |
| `embedded`        |                            386.4 s |                            9.6 s |                        4.7 s |

In `lint-test-build`, apt alone fetched 25.9 MB in 9m26s at 45.8 kB/s. The other jobs fetched the same packages in 5m35s and 6m16s. Browser caching removes the 8-10 second download/extraction portion on hits; cache transfer/extraction adds its own overhead. The slow apt transfer dominates the recorded installation time.

Local comparisons with the locked Playwright 1.61.0 used read-only dependency simulations:

| Command                                                                      | Duration | Planned package installs/upgrades | Exit code |
| ---------------------------------------------------------------------------- | -------: | --------------------------------: | --------: |
| `npx --no-install playwright install-deps --dry-run`                         |   3.31 s |                                68 |         1 |
| `npx --no-install playwright install-deps --dry-run chromium`                |   2.55 s |                                35 |         1 |
| `npx --no-install playwright install-deps --dry-run chromium-headless-shell` |   2.49 s |         35, identical to Chromium |         1 |

These simulations report exit 1 when packages would be installed or upgraded; they made no system changes. The timings cover dependency resolution, and the package counts describe the local environment. Playwright's [versioned dependency installer](https://github.com/microsoft/playwright/blob/v1.61.0/packages/playwright-core/src/server/registry/dependencies.ts) and [browser registry](https://github.com/microsoft/playwright/blob/v1.61.0/packages/playwright-core/src/server/registry/index.ts) confirm that Chromium and its headless shell use the same Chromium and tools dependency groups. The base workflows already requested Chromium alone. The fallback retains that smallest supported dependency group, including its font packages, while browser installation downloads only the headless shell.

An isolated local headless-shell/FFmpeg installation took 10.61 seconds and exited 0, with system libraries already available. A tar/zstd round trip produced a 108.3 MB archive in 1.90 seconds and restored it in 1.11 seconds; both commands exited 0. Launching and rendering from the restored cache also exited 0. The browser cache smoke gates use this separately restored copy, containing no full Chromium installation. Local archive/restore timings exclude GitHub network transfer.

When the initial launch check passes, setup skips the system-package work that took 345.0-576.5 seconds in these recorded jobs. This applies to both cached and freshly downloaded browsers. Subtracting the recorded 576.5-second dependency phase from the 19m01s `lint-test-build` job gives roughly 9m25s before accounting for the new launch check and browser-cache transfer. This is a projection from the base run. Web and embedded totals also depend on shard concurrency, shared-build and artifact overhead. Cold headless-only installation avoids about 4-5 seconds of full-browser download from the recorded jobs. If the fallback is needed, the apt transfer can still dominate setup. Compare the browser/dependency path logs and step durations in the first hosted run; hosted timings for this change remain unmeasured.

## Validation

### Original sharding validation

| Command or check                                                | Exit code |
| --------------------------------------------------------------- | --------: |
| `npm ci --legacy-peer-deps`                                     |         0 |
| `npm run lint`                                                  |         0 |
| `npm run lint:ratchet`                                          |         0 |
| `npm run typecheck`                                             |         0 |
| `npm test -- --runInBand`                                       |         0 |
| `npm run build`, including all five per-shard builds            |         0 |
| `npm run smoke:i18n`, isolated full run                         |         0 |
| Each web and embedded shard listed above                        |         0 |
| `npm run build:embedded`                                        |         0 |
| `npm run check:embedded`                                        |         0 |
| `npm run smoke:i18n:embedded`, full run                         |         0 |
| `npm run smoke:boot`                                            |         0 |
| Both `check-i18n-shards.mjs` aggregates                         |         0 |
| `node --test scripts/i18n-shards.test.mjs`                      |         0 |
| `node scripts/audit-gate.mjs`                                   |         0 |
| Plain `actionlint`                                              |         1 |
| `actionlint -ignore 'constant expression "false" in condition'` |         0 |

Jest passed 204 suites, 4,219 tests and 635 snapshots, with two existing suite/test skips. The shard contract suite passed 31 tests. Plain actionlint reports the existing disabled deployment job's `if: false`; the original workflow at the base revision produces the same diagnostic. The scoped actionlint run validates all workflow files while excluding that single existing diagnostic.

### Earlier browser cache validation

The fresh headless-only installation, tar/zstd restoration, all 294 restored file digests, and a browser launch/render check passed. The smoke commands use that restored cache. The composite action's version output, resolved key, branches for cache hits/misses/empty output, YAML and shell syntax were checked locally. Hosted cache service transfer and system package installation require a CI run.

| Command or check                                                                                 | Exit code |
| ------------------------------------------------------------------------------------------------ | --------: |
| `npm run lint`                                                                                   |         0 |
| `npm run lint:ratchet`                                                                           |         0 |
| `npm run typecheck`                                                                              |         0 |
| `npm test -- --runInBand`                                                                        |         0 |
| `npm run build`                                                                                  |         0 |
| `npm run build:embedded`                                                                         |         0 |
| `npm run check:embedded`                                                                         |         0 |
| `npm run smoke:boot`                                                                             |         0 |
| `node --test scripts/i18n-shards.test.mjs`                                                       |         0 |
| Every web shard, `npm run smoke:i18n -- --languages <language>`                                  |    0 each |
| Every embedded shard, `npm run smoke:i18n:embedded -- --languages <language>`                    |    0 each |
| `node scripts/check-i18n-shards.mjs --suite web --directory <reports>`                           |         0 |
| `node scripts/check-i18n-shards.mjs --suite embedded --directory <reports>`                      |         0 |
| Fresh headless download, cache archive/restore, digest comparison and browser launch/render      |    0 each |
| Composite version/key/branch checks and workflow comparison against the starting sharding change |         0 |
| Plain `actionlint`, existing `if: false` diagnostic only                                         |         1 |
| `actionlint -ignore 'constant expression "false" in condition'`                                  |         0 |

The full Jest rerun passed 204 suites, 4,219 tests and 635 snapshots, with two existing skips; shard-contract tests passed all 31 tests. The workflow comparison confirmed identical job names, matrices, dependency edges, aggregate checks and release/Docker gating. Dependencies, source files, the existing sharding scripts and the tag release workflow retain their starting contents.

All ten shards passed using the restored browser cache. Their wall times below include npm startup; they are validation timings, with some early checks overlapping other local gates. Both coverage aggregates passed with exactly 705 web pairs and 345 embedded pairs, each covered once.

| Language |     Web | Embedded | Exit codes (web, embedded) |
| -------- | ------: | -------: | -------------------------: |
| en       | 201.0 s |   36.8 s |                       0, 0 |
| de       |  91.7 s |   37.3 s |                       0, 0 |
| es       |  88.0 s |   35.6 s |                       0, 0 |
| ru       |  88.7 s |   38.5 s |                       0, 0 |
| zh-CN    |  89.5 s |   39.1 s |                       0, 0 |

### Conditional dependency validation

The local launch check passed with the installed Chromium and existing system libraries. The three requested gates for the conditional dependency change passed:

| Command                                                         | Exit code |
| --------------------------------------------------------------- | --------: |
| `actionlint -ignore 'constant expression "false" in condition'` |         0 |
| `node .github/actions/setup-chromium/check-launch.mjs`          |         0 |
| `npm run lint`                                                  |         0 |

The composite action's extracted steps also passed actionlint and Bash syntax checks. Eight simulated cases verified cache hits, cache misses, empty cache output, download failure, existing dependencies, successful dependency recovery, repeated launch failure and installer failure. The harness exited 0 after checking each command sequence, log message and expected step exit code. The fallback uses simulated commands in this local validation; actual apt recovery and hosted path timings remain to be measured in CI. File digests confirmed that the existing sharding changes and dependency manifests retain their starting contents.

## Font and strict-report validation on 2026-10-23

These checks used Node 22.22.3 and the locked Chromium with both display variables unset. The positive fontconfig included only fonts extracted from the pinned packages. The negative fontconfig included only DejaVu, which covers Latin and Cyrillic and excludes Chinese. Both used isolated writable fontconfig caches. The web and embedded Chinese shards passed 141 and 69 pairs respectively. Both negative runs failed at the glyph check before any scenario or screenshot, and wrote failed version 2 reports with zero completed pairs.

| Gate                                                                              |         Exit code |
| --------------------------------------------------------------------------------- | ----------------: |
| `actionlint -ignore 'constant expression "false" in condition'`                   |                 0 |
| Extracted composite action: actionlint; installer: `bash -n`                      |            0 each |
| `npm run lint`                                                                    |                 0 |
| `node --test scripts/i18n-shards.test.mjs` (129 tests)                            |                 0 |
| `node --test scripts/i18n-coverage.test.mjs` (12 tests)                           |                 0 |
| `node --test scripts/i18n-glyphs.test.mjs` (2 browser tests)                      |                 0 |
| `npm run build`; `npm run build:embedded`; `npm run check:embedded`               |            0 each |
| `npm run smoke:i18n -- --languages zh-CN`, fonts present                          |                 0 |
| `npm run smoke:i18n:embedded -- --languages zh-CN`, fonts present                 |                 0 |
| `npm run smoke:i18n -- --languages zh-CN`, Chinese fonts excluded                 |      1 (expected) |
| `npm run smoke:i18n:embedded -- --languages zh-CN`, Chinese fonts excluded        |      1 (expected) |
| Font provisioning with a cold package cache; with a populated cache               |            0 each |
| Font provisioning with a corrupt cached package                                   |      1 (expected) |
| Standalone glyph check for all five languages, including Cyrillic                 |                 0 |
| Both aggregate CLIs with complete synthetic controls                              |            0 each |
| Both aggregate CLIs with 15 malformed collections per suite                       | 1 each (expected) |
| Local positive/negative shard report schema and coverage verification             |                 0 |
| Workflow job/name/matrix/dependency comparison and dependency manifest comparison |                 0 |

The 30 negative CLI fixtures cover array and object language/screen values, unknown language/screen values, duplicate entries across shards, missing shards, wrong declared languages, another language's pairs, failed pairs, string pass/fail flags, and extra/missing fields. The harness exited 0 after checking every expected exit and diagnostic. The aggregate controls are synthetic report fixtures; the two Chinese shard runs used the freshly built wallet bundles. The cached font installation reused both archives without downloading them. An initial local installer attempt exited 5 because the default fontconfig cache was outside the writable sandbox; provisioning passed after selecting the isolated writable cache. Hosted cache timing remains unmeasured.
