# October 13 original-input capture

The fixed attempt `bayn-common-research-2026-10-13-01` registers the complete regular session from 13:30 to 20:00 UTC,
or 6:30 am to 1:00 pm Pacific. Bootstrap must finish before the open. Admission closes at 20:05 UTC. A failed attempt
retains its identity and cannot select a replacement date or restart under another nonce.

The [calendar observation](calendar.json) is a bounded connected Alpaca calendar read, normalized through Bayn's
existing calendar decoder. It is not a native trade snapshot. The configuration pins its exact file hash, normalized
calendar hash, observation time, all 16 symbols, the complete active momentum-first Jev protocol and the native
25-partition inventory. Its one-second research schedule grants no model, broker or capital authority.

## Persistence repair

The old one-second aggregate deadline invalidated real storage operations. Eight bounded measurements observed
object PUT at 35 to 2,665 milliseconds and SQL append at 1,682 to 9,202 milliseconds. Increasing the buffer alone still
overflowed under sustained peak input. The repaired writer keeps only the ownership claim and final seal in SQL.
Raw values and their metadata share one content-addressed object chain. Each drain verifies at most four frames
concurrently and advances its frontier only after all frames acknowledge.

The fixed bounds are 65,536 retained receipts, a 256 MiB payload reservation, 4 MiB per frame, ten seconds per object
operation and thirty seconds per persistence operation. The session also enforces its admission and stop deadlines.
Missing acknowledgements, overflow and integrity failures still invalidate capture. The final invalidated seal has
one bounded cleanup attempt after admission stops. No retry or weaker storage durability is added.

A real-storage stress run on an existing execution-worker Pod offered 170,440 market records with 500-byte original
values at 8,522 records per second for 20.218 seconds. That rate came from the current native arrival envelope's
one-second upper bound. Including STARTED and STOPPED, all 170,442 receipts persisted across 48 frames. The SQL seal
acknowledged with zero invalidations. A fresh S3 read verified the complete frame and metadata chains and all original
values. Sampled total Pod memory peaked at 782,368,768 bytes within its unchanged 1 GiB limit.

This finite synthetic stress run proves that exercised workload. It does not establish indefinite peak throughput,
every payload distribution, controller coverage, a complete original market session or economic qualification.
The calendar-registered native attempt must independently prove bootstrap, exact source interval, its actual cut,
durable seal and replay. Every export remains `UNQUALIFIED`.

## Delivery and acceptance

Deliver the repair and configuration through reviewed main, immutable image publication, the existing Kargo Stage
and Argo reconciliation. Verify one SQL ownership claim, the matching first object, successful native bootstrap,
bounded reservations and continued execution health. After the close, verify the seal and object chain, then run the
native-visible interval replay. Neither readiness nor the stress result completes that acceptance.

The existing reflected bucket credential, owner, destination and permissions are unchanged. The capture uses one
separate PostgreSQL connection and the same server-owned Kafka projection reused by lazy trading runtimes. The fixed
attempt creates no additional Kafka consumer and changes no trading, model, accounting, risk or capital authority.
