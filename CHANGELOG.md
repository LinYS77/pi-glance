# Changelog

## [Unreleased]

- Validate Pi 1.6 while retaining Pi 1.0 support. Pi 1.5 and later can show this changelog after an update.
- Skip Glance configuration and status collection in non-interactive sessions.
- Consolidate session billing and verify idle cache warming and moved-workspace forks.

## [0.7.7] - 2026-10-15

- Cache unchanged extension status text and Context snapshots to reduce repeated work.
- Default Git polling backs off from 5 to 30 seconds while unchanged; tool activity refreshes sooner.
- Add Pi 1.2 validation and regressions for cache invalidation, Git recovery and real session events.

Validated on Pi 1.0.0 / 1.2.0 and Node 22 / 24: 348 tests per combination.

## [0.7.6] - 2026-10-07

- Output throughput now counts all reported output tokens, including reasoning, over full request time. Higher readings reflect this metric change.
- Simplify the status line to `tok/s`, keeping `~` for provisional results.
- Remove unused throughput bookkeeping and redundant tests; clarify internal retry timing.

## [0.7.5]

- Require Pi 1.0.0+ and use its public theme appearance.
- Preserve the existing config, Text/Sweep activity, and native editor while removing compatibility code.
- Throughput includes the contribution from [@derekszen](https://github.com/derekszen) in [#7](https://github.com/LinYS77/pi-glance/pull/7).
