# The Crucible — Nexus plugin

This package exposes The Crucible as an optional Nexus plugin rather than hard-wiring Crucible behavior into Nexus itself.

## What it adds

- Project actions for Crucible validation and release gating.
- An inspector-panel contribution describing the expected Crucible project integration points.
- Command-palette entries for validation, release-gate, and governance inspection.
- Activation/deactivation telemetry through Nexus's permitted plugin telemetry surface.

## Security model

The plugin intentionally does **not** request arbitrary process execution, workspace write, Git write, secrets, or unrestricted network access. It returns host-action descriptors such as `npx the-crucible validate` and `npm run release:crucible`; Nexus remains responsible for presenting, authorizing, and executing those actions.

## Install in Nexus

Use Nexus's Plugins UI to import this folder. Nexus will validate `nexus.plugin.json`, security-screen the package, install it disabled, and then allow the user to enable it. The installed plugin can then be packaged and published through Nexus's existing plugin marketplace flow.

## Source

The Crucible itself remains a separate project. This Nexus plugin is an adapter/entry point and does not copy or mutate The Crucible's source repository.
