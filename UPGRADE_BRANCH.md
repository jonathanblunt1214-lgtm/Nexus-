# Nexus Upgrade Branch

All Nexus upgrade work from Section 2 onward is consolidated on `upgrade/nexus-overhaul`.

Sections 0 and 1 are already merged to `main`. Sections 2 through 8 and the release-hardening work have been completed and merged previously; this branch remains the single update line for follow-up UX work.

The current UI pass replaces the old icon/emoji-heavy developer shell with a modern responsive application shell: text-first navigation, calm neutral surfaces, restrained accent color, responsive horizontal navigation at compact widths, accessible focus states, clearer project onboarding, and modernized cards/tool drawers. Backend behavior, IPC boundaries, approval gates, and Section 0-8 security semantics are intentionally unchanged.

Future Nexus update work should continue on this branch unless explicitly redirected.
