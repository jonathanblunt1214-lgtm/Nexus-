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
- Includes the language-service stability and heavy-workload plug-in fixes tested across Windows, macOS, and Linux.
