# Nexus 1.0.2

- Fixed Add a Project so Nexus automatically derives the display name from a selected folder or GitHub repository.
- Added support for GitHub shorthand such as `owner/repository` and `github.com/owner/repository`.
- Fixed the installed-app startup update check so updater events are registered before the window loads.
- Added a trusted launch preflight that installs missing locked dependencies, builds missing compiled output, verifies the expected start file, and keeps sandboxed preparation inside Docker.
- Includes the language-service stability and heavy-workload plug-in fixes tested across Windows, macOS, and Linux.
