# Nexus Feature Roadmap

Single priority-ordered list. **Stability and program health come first,**
then remaining feature-parity work, in the order below. Updated every time
an item lands — check `git log` for the actual commit.

## ✅ Completed

- [x] Global error surfacing (both processes: uncaught exceptions and
      unhandled promise rejections in the renderer AND the main process now
      show as a dismissible toast, instead of vanishing silently unless
      DevTools happens to be open)
- [x] GitHub URL cloning in Add a Project (real `git clone`, not a stub)
- [x] Auto-updater wiring (`electron-updater`, checks GitHub Releases)
- [x] Preview webview: blank-start fix (no hardcoded `localhost:3000`)
- [x] Preview webview: CSP/`frame-ancestors` header stripping (dedicated session partition)
- [x] Preview webview: popup allowlist (Google/Firebase/GitHub OAuth only, not a blanket `allowpopups`)
- [x] Preview webview: stale Service Worker auto-clear on launch + manual "Clear Preview Cache"
- [x] Auto-push to GitHub (Windows Scheduled Task, real commit+push, timestamped, logged)
- [x] Per-project editing (name/folder/command/port) via card ✎ button
- [x] Workspace merge: Live Preview + Terminal + Ship + AI Assist as one resizable 2×2 grid
- [x] Per-project Config panels (moved from a global tab into each project's own card)
- [x] Code Editor: real file tree, tabs, syntax highlighting (CodeMirror), save via existing backup-on-write path
- [x] Prompt-driven coding inside the Code Editor (ask Claude to write/modify a file, review diff, approve)
- [x] Claude-style composer for the above (auto-growing textarea, "+" menu: attach file, include terminal output, hand off to Feature Builder)
- [x] Project-wide search & replace (real file contents, not just the open file)
- [x] Real git diff viewer in Ship (colored +/- line-by-line, not raw `git status` text)
- [x] Command Palette (Ctrl+K, 22+ real actions, all mapped to existing functions)
- [x] New Project from a Prompt (Claude generates a full real starter file set)
- [x] Linting/formatting on save (runs the project's OWN installed ESLint/Prettier - never a version bundled with Nexus)
- [x] Commit history / branch viewer (real `git log`, branch tags per commit, click any commit to see its real diff)
- [x] Test runner UI (real per-test results for Jest/Vitest, rerun a single failing test — honest fallback to plain output for unsupported frameworks)
- [x] API testing tool (real HTTP requests sent from the main process, no CORS issues; real per-project saved-request collection in `.nexus-api-requests.json`)
- [x] Docker integration (real `docker` CLI: build with streamed output, run/stop/remove containers, live log streaming — checks for a real installed/running Docker, never faked)
- [x] Build number in the header, tied to real git commit count (not a manually-tracked counter — automatically accurate forever); also shown on the real OS window title bar
- [x] Package manager UI (real `npm install`/`uninstall`/`update`, streamed output; installed versions read directly from `node_modules`, not just trusted from `package.json`'s semver range; real `npm outdated` check)
- [x] Schema versioning for the saved project list (malformed entries dropped with a visible warning instead of crashing; safe defaults filled for genuinely optional fields; identity fields like `projectUid` never fabricated; also fixed a real latent bug where a project's `running` state was trusted from a previous session even though no process actually survives an app restart)
- [x] Central "recent changes" log with one-click revert (every write through `apply-file-change`, Search & Replace, and Format/Lint is now recorded with a real source label and can be reverted from one place — also closed a real gap found while building this: Format/Lint was modifying files with zero `.bak` backup before)
- [x] Unified "Activity" view (⚡ icon, live status dot; aggregates real state from running dev servers, `docker ps`, and package-manager operations — not a separate tracking system that could drift out of sync with reality)
- [x] Accessibility pass (`aria-label` on all 9 sidebar buttons and 6 close buttons; `role="dialog"`/`aria-modal` on all 8 overlay panels; `role="navigation"` on the sidebar; a real global Escape key that closes whichever overlay is actually open, checked in correct stacking order)
- [x] Backup/export of "my Nexus setup" (real export to a JSON file via native save dialog, real import with duplicate-by-folder detection and malformed-entry filtering — secrets deliberately excluded and the UI says so plainly, since `safeStorage` encryption is tied to the Windows account and can't be moved)
- [x] Nexus's own automated tests (33 real tests, `node --test`, zero new dependencies — six genuinely pure functions extracted from `main.js` into `pureLogic.js` first, verified byte-for-byte identical behavior via full regression suite, *then* tested; the test run itself caught one real bug — in the test's own expected value, not the code — which was verified against actual behavior before fixing)
- [x] Consistent toast notifications for routine feedback (generalized the existing error-toast system to support success/info too; converted the 12 genuine success/info confirmations — "Committed and pushed," "Package installed," changelog/constitution/`.env` saves, exports/imports, etc. — to non-blocking toasts; deliberately left `confirm()` dialogs and simple validation-guard `alert()`s like "Enter a URL first" untouched, since those need a real answer or the user's attention before continuing, which a toast can't provide)
- [x] Persisted Workspace layout (divider position now saved to `localStorage`, debounced during drag, restored on next launch instead of resetting to 50/50 every time; corrupt/out-of-range saved values safely fall back to the 50/50 default rather than breaking the grid — verified behaviorally against 6 real scenarios, not just syntax-checked)

## ⬜ Up Next — stability & program health (priority 1)

*(empty — every item on this list is now complete)*

## ⬜ Up Next — remaining features (priority 2)

Tackled only after everything above is done, roughly in this order:

- [ ] Database browser (inspect Firestore/SQL data without leaving Nexus)
- [ ] PR/merge-request flow (open/review pull requests from inside Nexus)
- [ ] Merge-conflict resolution UI (currently: drop to raw git commands)
- [ ] Stash management
- [ ] Real language intelligence / LSP (autocomplete, go-to-definition, inline type errors — a much bigger build than the rest of this list, likely needs Monaco instead of CodeMirror)
- [ ] A real debugger (breakpoints, step-through, variable inspection)
- [ ] **Smart defaults when adding a project.** Command and port are always
      manual entry right now — no detection of "this is a Vite project, so
      it's probably `npm run dev` on 5173" the way Replit or Vercel infer
      from `package.json`. Real friction at the exact moment someone's
      forming their first impression of a newly added project.
- [ ] **Dockable panels instead of modal takeovers.** Code Editor, API
      Tester, Docker, Package Manager, Recent Changes, and Activity are six
      full-screen overlays that are all mutually exclusive — opening one
      visually replaces whatever else was open, so e.g. Package Manager
      output can't be seen alongside the Code Editor. Only the original
      Workspace 2×2 grid actually supports seeing multiple things at once;
      everything built since has used a separate, inconsistent overlay
      pattern instead of extending that grid. A real architecture change,
      not a small fix — treat as its own project when tackled.
- [ ] **Per-project config isn't repo-portable.** A project's services
      list, deploy command, and secrets metadata live in Nexus's own local
      storage on the machine that configured them — not in the project's
      repo. `CONSTITUTION.md` travels with the code because it's a real
      file; the rest doesn't. A teammate opening the same repo in their own
      Nexus starts from zero on all of it, with no way to share that setup
      the way a `devcontainer.json` would. Real design tension between
      "Nexus as a personal tool" and "Nexus as something a team could
      standardize around" — needs a decision on which Nexus is meant to be
      before building a fix, not just an implementation task.

## Not planned — by design, not oversight

- Real-time multiplayer/pair editing
- Shareable live-preview links
- Remote/cloud execution

Nexus is intentionally local-first — everything running on your own machine
is the actual point, not a limitation to fix.
