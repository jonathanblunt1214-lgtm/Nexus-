# The Crucible — Nexus plugin

This package exposes The Crucible as an optional Nexus plugin rather than hard-wiring Crucible behavior into Nexus itself.

## What it adds

- An explicit **Auto Inject The Crucible** project action.
- Project actions for Crucible validation and release gating.
- An inspector-panel contribution describing Crucible integration state.
- Command-palette descriptors for injection, validation, release-gate, and governance inspection.
- Activation/deactivation and injection telemetry through Nexus's permitted plugin telemetry surface.

## Auto Inject behavior

Auto Inject is **OFF by default**. Installing or enabling the plugin does not modify the project.

When the user explicitly selects/confirms `crucible-auto-inject`, the plugin uses Nexus's sandboxed `workspace:write` capability to add a Crucible governance bootstrap to the active project:

- `.nexus/crucible-auto-inject.json`
- `governingDocuments/agent-progress-policy.md`
- `governingDocuments/templates/injection-chain-of-command.md`

Existing files are not overwritten unless the caller separately requests `overwrite: true`. The action therefore fails closed if a receiving project already has one of these paths and overwrite was not explicitly authorized.

The injected policy files are bundled from The Crucible's governing-document baseline. This bootstrap does not silently install CI workflows, mutate Git history, alter branches, add secrets, or enable a permanent monitor.

## Security model

The plugin requests only `ui:slot`, `workspace:write`, and `telemetry:emit`. It does **not** receive arbitrary process execution, Git-write, secrets, or unrestricted network access. Nexus constrains plugin writes to relative paths inside the authorized project root, rejects path traversal and symlink escapes, limits write size/count, and uses atomic file replacement.

## Install in Nexus

Use Nexus's Plugins UI to import this folder. Nexus validates `nexus.plugin.json`, security-screens the package, installs it disabled, and lets the user review permissions before enabling it. Auto Inject still remains off after enablement until explicitly selected.

The installed plugin can then be packaged and published through Nexus's existing plugin marketplace flow.

## Source

The Crucible itself remains a separate project. This Nexus plugin is an optional adapter/entry point and does not copy or mutate The Crucible's source repository.
