# The Crucible — Nexus plugin

The Crucible is an optional Nexus plugin. Installing or enabling it does not automatically modify a project.

## Plugin configuration

When the plugin is enabled, Nexus exposes a **Configure governance** control. It lists every text file under the active project's `governingDocuments/` tree, lets the user open and edit any file, and allows new governance files to be created under that same tree.

Governance edits are normal project files. They remain visible to the project and are subject to the project's normal source-control, review, validation, and governance rules.

## Auto Inject

**Auto Inject The Crucible** remains unchecked and off by default. The user must explicitly select it, apply the selection, and confirm the injection. Existing bootstrap files are not overwritten unless overwrite is separately authorized.

## Private injection tracking

When Auto Inject succeeds, the plugin records the injected file list in the Nexus account that performed the injection. The ledger is stored in `nexusCruciblePluginTracking/{userId}`, a dedicated Firestore document protected by an authenticated-UID match and verified-account rule, and is queried through the plugin's `account:private` capability.

The plugin does **not** write an injection-history ledger into the project, repository, `.nexus/plugins`, or governance tree. A project collaborator therefore sees the governance files themselves but not the plugin's private injection history. The **My injection history** control only queries records belonging to the currently signed-in Nexus account.

If the user is not signed in, governance injection can still complete, but private tracking reports that it could not be recorded until a Nexus account is available.

## Permissions

The plugin requests:

- `ui:slot` for its Nexus controls.
- `workspace:read` to list and open governance files.
- `workspace:write` to save governance edits and perform explicitly selected Auto Inject operations.
- `account:private` for account-scoped injection history.
- `telemetry:emit` for bounded plugin lifecycle/action telemetry.

Workspace paths are constrained to the authorized Nexus project and reject traversal/symlink escapes. The governance editor additionally limits edits to `governingDocuments/`.

## Source separation

The Crucible itself remains a separate project. This Nexus plugin is an adapter and configuration surface; it does not make The Crucible part of Nexus's default runtime.
