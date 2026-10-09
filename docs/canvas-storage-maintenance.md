# Canvas storage maintenance

The Settings storage maintenance section uses a read-only inventory and explicit reversible quarantine. It never deletes registered assets, edits database records, or permanently removes media. The scan reads app-managed data under `dataRoot`; it does not inspect external workspaces.

Only direct regular media files under `dataRoot/canvas/<canvasId>/` can become candidates. Registered assets remain protected even after their source node, canvas, or job disappears. The reference pass examines every SQLite text column, including node params/output, masks, nested imports, anchors, selected and older output versions, retained commits, command receipts, jobs input/result/remote task data, deliveries, messages and artifact history. It also reads file-backed JSON sessions, metadata and spilled tool outputs. JSON string decoding, slash normalization and URL decoding preserve older path forms.

Files created or changed within 24 hours, hidden files, `.part`/`.tmp` files, unknown names/types, nested directories, links and junctions require review. No links below the data root are followed. Invalid JSON, unreadable reference stores, unsupported persistent file formats, additional databases or scan limits cause all remaining candidates to require review. A referenced or registered file stays protected in an incomplete scan.

Native image-page PPTX exports are recognized only when their local export job, captured input, successful result, exact artifact version and file hash all agree, and their real package contains self-contained image slides. Their persisted source page paths remain protected. Arbitrary uploaded binary files, corrupt packages, unregistered versions and files beyond the conservative reference byte budget still require review. See [native presentation export](canvas-presentation-export.md).

The API uses the existing loopback/origin guard:

| Request | Result |
| --- | --- |
| `GET /api/canvas-maintenance/scan` | Token valid for 10 minutes, reference completeness/warnings, and files classified as `protected`, `review` or `candidate`. |
| `POST /api/canvas-maintenance/quarantine` | JSON `{token, paths}` and a stable `Idempotency-Key`; explicitly select 1–100 candidates. |
| `GET /api/canvas-maintenance/quarantine` | Durable quarantine batches with `pending`, `quarantined` or `restored` entries. |
| `POST /api/canvas-maintenance/quarantine/<batchId>/restore` | JSON `{paths}` naming entries in that batch. |

Retain the same operation key and selection when retrying a lost response. A changed selection or new scan needs a new key. The server checks the token, rereads references, compares file identity and age, then performs the final checks/moves synchronously while holding SQLite's write lock. Unknown or changed files are rejected. Scans cap the inventory at 20,000 files and reference text at 64 MiB/200,000 cells; exceeding a cap makes the scan incomplete instead of claiming files are safe.

Quarantine lives at `dataRoot/canvas-quarantine/<batchId>/`. Its manifest contents are flushed before any media moves and after each entry; the media stays on the same filesystem. Exclusive links prevent overwriting destinations. A batch can remain partially isolated after an I/O failure or process interruption; its manifest records recovery paths. `pending` entries can be restored whether the interruption occurred before or after their move. Restore checks safe root-contained paths and file identity, never overwrites a different file at the original path, and is idempotent. Empty or initial temporary-only batches do not hide valid recovery records; damaged records remain visible with `reviewReason` and require manual review. Keep the quarantine directory and manifests together. There is no purge API or automatic cleanup timer.

This implementation supports ordinary I/O failures and process interruption recovery. It does not promise sudden power-loss durability: directory entries and filesystem metadata depend on platform/filesystem flushing behavior. Windows directory flushing is unavailable through this Node file layer. Non-NTFS filesystems, packaged-app behavior and actual power-loss recovery remain unverified; no external PowerShell/.NET dependency is introduced. Filesystems without hard-link support reject isolation while retaining originals and the recovery manifest.

Validation uses disposable SQLite databases and temporary directories: historical/registered/legacy/mask/job/receipt/spilled references stay protected; only an explicitly selected orphan moves; restoration keeps exact bytes; new references reject stale tokens; conflicting original files and traversal are refused; junctions are not traversed; malformed persisted JSON makes the scan incomplete. No user data was scanned or changed during development.
