# Nexus Upgrade Branch

All Nexus upgrade work from Section 2 onward is consolidated on `upgrade/nexus-overhaul`.

Sections 0 and 1 are already merged to `main`. Sections 2 through 8 are carried on this branch.
Future Nexus upgrade work should branch from and update this branch until the upgrade program is merged to `main`.

The completed Sections 0–8 release hardening pass now includes reproducible lockfile installs, renderer plugin bridge integration, authorized-workspace plugin IPC, killable worker-isolated plugin execution, atomic Nexus config persistence, cross-platform testing, and Windows installer smoke coverage.
