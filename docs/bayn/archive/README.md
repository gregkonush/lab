# Archived Bayn records

This directory retains dated, point-in-time records that are no longer current guidance. They are kept as written apart
from an archive banner and the relative-link fixes required by the move, because they document what was observed,
decided or deployed at a specific commit and time. Do not read them as the present system state.

Current guidance lives in:

- [service README](../../../services/bayn/README.md) for runtime, execution, accounting and deployment contracts;
- [architecture](../architecture.md) for component ownership and the execution flow;
- [strategy protection](../strategy-protection.md) for the active protocol, plan funding and broker protection;
- [net edge research](../net-edge-research.md) for the economic-evidence boundary.

## Retained records

| Record                                                       | Date           | Why archived                                                                                                                        |
| ------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [System review](system-review-2026-10-18.md)                 | 18 Oct 2026    | Operational snapshot at one deployed image and protocol revision; its accounting totals, strategy parameters and image are stale.   |
| [System cleanup](system-cleanup-2026-10-20.md)               | 20 Oct 2026    | One-off database and observability audit for migrations that have since been applied; it is not a retention or health guarantee.    |
| [Harness2 design audit](harness2-design-audit-2026-10-20.md) | 20–22 Oct 2026 | Design assessment of a retired adapter; the resulting optimizer decision is recorded in [Jev optimization](../jev-optimization.md). |

Each entry describes the evidence it had at the time. None of them authorizes a strategy, risk, capital or deployment
change, and none establishes profitable trading.
