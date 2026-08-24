# Nexus 1.0.2

- Fixed Add a Project so Nexus automatically derives the display name from a selected folder or GitHub repository.
- Added support for GitHub shorthand such as `owner/repository` and `github.com/owner/repository`.
- Fixed the installed-app startup update check so updater events are registered before the window loads.
- Added a trusted launch preflight that installs missing locked dependencies, builds missing compiled output, verifies the expected start file, and keeps sandboxed preparation inside Docker.
- Added a read-only dependency/readiness scan that begins while GitHub project files download, plus a separate checker-only Workspace Trust permission that grants no general command access.
- Added a Nexus-only offline SHA-256 inventory for every tracked source file and relative code reference, enforced by GitHub Actions.
- Added package-content verification so signed and GitHub update builds fail before publication when any required Nexus file is missing from the application archive.
- Added hash-verified recovery for missing Nexus release-staging files: retrieve only the missing path from GitHub, retry twice, restore atomically only when it matches the offline baseline, then rerun verification. Changed files are never overwritten automatically.
- Made the four-workload heavy-load stress gate mandatory before every release, including direct publish commands.
- Added an upgrade-first promotion protocol: main accepts the exact validated upgrade commit only after all cross-platform, package, inventory, and stress checks succeed; divergence and main-only changes are rejected.
- Added protected project export for apps, websites, and APIs: the existing deterministic checker API, local-reference validation, and a complete SHA-256 file manifest must pass in staging before Nexus copies and reverifies the export outside staging.
- Changed failed main promotions into an upgrade-branch remediation and retry cycle: restore hash-matched missing files, apply only independently rechecked deterministic checker corrections, rerun every gate, and promote only the repaired upgrade commit.
- Fixed plug-in handler timeouts under heavy scheduler contention by starting the strict execution timer only after the isolated worker confirms that the handler began.
- Fixed Settings & Keys vertical scrolling so profiles, connected services, vault controls, GitHub settings, and AI API keys remain reachable at every supported window height.
- Replaced the Settings scroll-fest with Account, GitHub, AI & API Keys, Project, and System sections; fixed broken legacy GitHub-settings navigation and made diagnostic messages visible.
- Enabled vertical scrolling on every ordinary page while preserving the specialized internal scrolling layout in Run & Preview.
- Kept ordinary-page scrolling available through mouse, touchpad, touch, and keyboard without showing permanent retro scrollbar tracks.
- Includes the language-service stability and heavy-workload plug-in fixes tested across Windows, macOS, and Linux.
