# GeoPackage metadata benchmark — 4 November 2026

## Decision and scope

**Keep `tuflowValidator.enableGeoPackageLayerChecks` disabled by default.** This run confirms bounded catalog reads and per-pass deduplication for the synthetic cases below on a local Linux container. It does not establish Windows installation, real QGIS concurrency, project-network performance, multi-GB feature-data behavior, or end-to-end VS Code responsiveness. It does not close the remaining environmental acceptance criteria in issues [#3](https://github.com/Chain-Frost/tuflow_validator/issues/3) or [#8](https://github.com/Chain-Frost/tuflow_validator/issues/8).

The [raw JSON](2026-11-04-gpkg-local.json) contains every trial, inventory counters, fixture sizes and integrity hashes. The [harness](../../src/test/benchmarkGeoPackage.ts) calls the same worker-backed inventory service used by the extension. It creates genuine SQLite/GeoPackage fixtures using the [test fixture helper](../../src/test/helpers/gpkgFixtures.ts); Python is needed to generate these development fixtures, not to run the extension.

## Environment and reproducibility

| Item | Recorded value |
| --- | --- |
| Completed | 2026-11-04T04:17:59.837Z |
| Runtime | Node v24.22.1; Linux 6.18.57; x64 |
| CPU exposed to container | AMD EPYC 9V74 80-Core Processor; 9 logical CPUs |
| Memory exposed to container | 9.73 GiB |
| Storage | Temporary files under `/tmp` on a container overlay filesystem; physical backing device and contention unknown |
| Network storage | Not measured |
| Code identity | PR working tree on baseline `4a0282e93b979345374076fb0adc60c7faf6af99`; compiled module SHA-256 values recorded in raw JSON |
| Repetitions | 30 per mode per case; 20 cases; 1,800 timed matrix trials plus one first-worker read |

The benchmark ran before the implementation commit, so the baseline commit alone is not the identity of the new code. The raw record includes hashes of the actual compiled benchmark, fixture helper, reader, inventory service and worker, and verifies that they did not change during the run. Re-run after changes to the measured implementation. A separate temporary build was used for this run to avoid concurrent extension builds changing the measured JavaScript.

After installing development dependencies, the normal reproduction commands are:

```bash
npm run compile
TPV_BENCHMARK_OUTPUT=docs/benchmarks/gpkg-local-rerun.json node out/test/benchmarkGeoPackage.js
```

PowerShell equivalent:

```powershell
npm run compile
$env:TPV_BENCHMARK_OUTPUT = "docs/benchmarks/gpkg-local-rerun.json"
node out/test/benchmarkGeoPackage.js
```

Optional environment settings: `TPV_BENCHMARK_TRIALS` (5–200; default 30), `TPV_BENCHMARK_DIRECTORY` (parent directory for disposable fixtures; default OS temporary directory), `TPV_BENCHMARK_STORAGE_LABEL` (record actual storage conditions), and `TPV_TEST_PYTHON` (fixture-generation interpreter). The harness removes its generated fixtures after checking integrity. Do not use a production database as a generated fixture.

## Method

- **Off surrogate:** one `fs.existsSync()` per reference, matching the physical-existence operation. It does not invoke the metadata service.
- **Cache cleared:** the same path checks plus calls through a fresh `createGeoPackageInventoryPass()`. The worker inventory caches are invalidated before each trial. Workers remain alive, and the OS/storage caches are warm or uncontrolled; this is not a cold-disk measurement.
- **Warm:** a fresh inventory pass after untimed priming. Header and file-identity verification remain enabled. Warm cache hits therefore still open each distinct database and read its header twice.
- References are processed sequentially, including repeated references to the same file. The 16-database case cycles references through up to 16 files. Each distinct returned inventory is checked against its expected complete layer list once per pass.
- Mode order rotates each trial. Fixture creation, hashing, warm priming and timer-drain waits are outside elapsed-time measurements. The first worker startup is recorded separately, and both worker slots are warmed before the matrix.
- Median is the central value or mean of the central pair; p95 is nearest rank. This is a 30-sample local microbenchmark, not a statistical service-level guarantee.

The measured function excludes control-file parsing, recursive graph traversal, latest-version directory scans, selector-diagnostic construction, editor debounce, watcher delivery and rendering. In particular, it is an inventory-service comparison with an off surrogate, not a measured complete extension setting toggle. The datasets are deliberately synthetic, and the runs share a process and operating-system caches.

## Datasets

| Dataset | Spatial layers per GPKG | Physical bytes per GPKG | Payload |
| --- | ---: | ---: | --- |
| 1 layer | 1 | 53,248 | Empty spatial tables |
| 8 layers | 8 | 81,920 | Empty spatial tables |
| 100 layers | 100 | 483,328 | Empty spatial tables |
| 1 layer + 16 MiB payload | 1 | 16,850,944 | 16,777,216 bytes in a registered attributes-table SQLite zeroblob |
| Up to 16 distinct GPKGs | 1 | 53,248 | Empty spatial tables |

The 16 MiB payload is genuinely allocated through SQLite. It is not a sparse file, populated geometry, or a representative multi-GB project model. The empty spatial layer and separate registered attributes payload isolate the cost of unrelated data volume from spatial catalog size. No sparse-2-GiB result is claimed.

## Timing results

All timing pairs below are **median / p95 in milliseconds**. Every value comes from the linked raw JSON.

| Dataset | References | Off surrogate | Cache cleared | Warm | Added median, cleared / warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 layer | 1 | 0.006 / 0.012 | 0.452 / 0.707 | 0.215 / 0.438 | 0.446 / 0.209 |
| 1 layer | 10 | 0.013 / 0.043 | 0.439 / 1.345 | 0.249 / 0.375 | 0.426 / 0.236 |
| 1 layer | 100 | 0.071 / 0.121 | 0.548 / 1.631 | 0.385 / 0.589 | 0.477 / 0.314 |
| 1 layer | 1000 | 0.581 / 1.004 | 1.760 / 3.346 | 1.636 / 2.593 | 1.179 / 1.055 |
| 8 layers | 1 | 0.004 / 0.005 | 0.601 / 0.844 | 0.216 / 0.998 | 0.597 / 0.212 |
| 8 layers | 10 | 0.010 / 0.023 | 0.525 / 0.826 | 0.264 / 0.360 | 0.515 / 0.254 |
| 8 layers | 100 | 0.061 / 0.091 | 0.627 / 0.852 | 0.378 / 0.555 | 0.565 / 0.317 |
| 8 layers | 1000 | 0.579 / 0.924 | 1.812 / 2.370 | 1.562 / 2.006 | 1.233 / 0.983 |
| 100 layers | 1 | 0.005 / 0.021 | 1.088 / 3.321 | 0.233 / 0.427 | 1.083 / 0.228 |
| 100 layers | 10 | 0.010 / 0.029 | 1.008 / 1.720 | 0.254 / 0.443 | 0.998 / 0.245 |
| 100 layers | 100 | 0.060 / 0.089 | 0.994 / 1.191 | 0.374 / 0.498 | 0.934 / 0.315 |
| 100 layers | 1000 | 0.601 / 1.005 | 2.459 / 4.179 | 1.783 / 2.699 | 1.857 / 1.182 |
| 1 layer + 16 MiB payload | 1 | 0.005 / 0.006 | 0.382 / 0.545 | 0.210 / 0.381 | 0.378 / 0.206 |
| 1 layer + 16 MiB payload | 10 | 0.010 / 0.012 | 0.407 / 0.572 | 0.211 / 0.431 | 0.397 / 0.201 |
| 1 layer + 16 MiB payload | 100 | 0.060 / 0.116 | 0.524 / 0.806 | 0.375 / 0.829 | 0.464 / 0.315 |
| 1 layer + 16 MiB payload | 1000 | 0.609 / 1.033 | 1.891 / 2.767 | 1.664 / 1.868 | 1.281 / 1.055 |
| Up to 16 distinct GPKGs | 1 | 0.004 / 0.007 | 0.471 / 0.964 | 0.226 / 0.389 | 0.467 / 0.221 |
| Up to 16 distinct GPKGs | 10 | 0.011 / 0.028 | 3.031 / 3.777 | 1.661 / 2.536 | 3.021 / 1.651 |
| Up to 16 distinct GPKGs | 100 | 0.089 / 0.173 | 5.979 / 10.772 | 3.106 / 7.103 | 5.890 / 3.017 |
| Up to 16 distinct GPKGs | 1000 | 0.689 / 1.095 | 7.402 / 11.493 | 4.805 / 9.140 | 6.713 / 4.116 |

**First worker read:** 61.868 ms for a single small database, including creation of one worker. This is a single observation and has no meaningful p95. It is separate from the steady-state cache-cleared rows above.

## I/O, deduplication and read-only evidence

| Dataset | Cache-cleared catalog reads per distinct DB per pass | Cache-cleared bytes / pages per distinct DB | Warm bytes / catalog reads per distinct DB |
| --- | ---: | ---: | ---: |
| 1 layer | 1 | 12,488 / 3 | 200 / 0 |
| 8 layers | 1 | 12,488 / 3 | 200 / 0 |
| 100 layers | 1 | 37,064 / 9 | 200 / 0 |
| 1 layer + 16 MiB payload | 1 | 12,488 / 3 | 200 / 0 |

At 1,000 references to one database, each pass made one worker request and one database open. At 1,000 references across 16 databases, it made 16 worker requests/opens: 199,808 bytes and 16 catalog reads with caches cleared, or 3,200 header bytes and zero catalog reads when warm. Off trials made no metadata requests. These counts were asserted in every trial, not inferred from timing alone.

The one-layer small database and the database containing the 16 MiB attributes payload both required 12,488 bytes per cache-cleared inventory. The 100-layer database required 37,064 bytes. These fixtures demonstrate that this implementation did not read the unrelated payload; they do not prove behavior for every real GeoPackage layout.

All **20 generated files** retained identical full-file SHA-256, size, modification time and change time before/after the run. The directory file list was unchanged; no sidecar was created or removed. All expected inventories matched, all read counters satisfied their assertions, and there were **zero timeouts**. Access time was not an integrity criterion, because normal reads can update it. Locking/WAL and real QGIS concurrency were not exercised by this harness.

## Responsiveness and resources

A 2 ms heartbeat sampled additional main-thread scheduling delay. Per-trial observation extends through an untimed 3 ms drain so a delayed timer can fire. Instrumentation, untimed work near sample boundaries, garbage collection and shared-host scheduling can affect these observations; they are not editor/UI latency measurements.

| Mode | Heartbeat observations | Largest observed additional delay (ms) | p95 of per-trial maximum delays (ms) |
| --- | ---: | ---: | ---: |
| off | 935 | 3.587 | 0.796 |
| metadata-cache-cleared | 1374 | 4.654 | 1.573 |
| metadata-cache-warm | 1017 | 5.907 | 1.251 |

At most two worker threads were active. Sampled whole-process peak RSS during the matrix was 118.0 MiB. RSS before worker startup was 59.0 MiB and after worker disposal was 110.4 MiB. These are not isolated feature-off/on memory comparisons: off trials retain idle workers, the harness retains raw samples, fixture hashing allocates buffers, and V8 does not necessarily return allocated memory immediately. No sustained-session leak conclusion follows from those values.

Linux descriptor snapshots were 19 before workers, at most 27 after individual trials, and 19 after both workers terminated. These are snapshots outside timed work, not peak-handle profiling. The harness reports descriptor counts as unavailable on platforms without `/proc/self/fd`.

## Remaining acceptance evidence

Use the [local Windows handoff](../work/2026-11-04-windows-validation-handoff.md) to obtain packaged VS Code installation results, Windows path/watch behavior, actual QGIS locks/edits and journal transitions, mapped-drive and UNC measurements, unavailable-share behavior, genuine multi-GB models, and full cold/incremental/editor timing. The cloud extension integration runner also needs an independent CI outcome; this metadata benchmark is not a replacement for that suite.

No representative network acceptance threshold or default-on decision is established by this run. Retain opt-in behavior and report unmeasured cases explicitly.
