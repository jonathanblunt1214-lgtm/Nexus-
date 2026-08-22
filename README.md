# Nexus Developer OS — Setup Guide

This is a real desktop app (built with Electron), not a webpage. That means
it can actually do the things the old version only pretended to:

- **Terminal tab** — runs real shell commands on your machine (`dir`, `cd`,
  `git status`, `npm install`, anything).
- **Projects tab** — you pick a *real* folder on your computer, give it a
  real start command (default `npm run dev`), and Nexus actually spawns
  that process.
- **Preview tab** — shows the real page served by that process, plus a live
  log of its console output.
- **AI Assist tab** — Bug Fix Assist and Feature Suggestions are powered by
  **NVIDIA NIM** (NVIDIA's hosted inference API, currently the
  `qwen/qwen3-coder-next` model). Bug fixes always show you a before/after
  diff and require your approval before any file is written, unless you
  explicitly opt into autonomous mode for that session.
- **Cloud tab** — the general-purpose "Ask" box still uses Gemini if you
  want a second model handy; the two keys are independent.

## Fastest way to run it (recommended — idiot-proof version)

1. Unzip this `nexus-app` folder anywhere, e.g. your Desktop.
2. Double-click **`START-NEXUS.bat`**.

That single file does everything: checks if you have Node.js, and if you
don't, installs it *for you automatically* using Windows' built-in App
Installer (`winget`) — no visiting nodejs.org, no clicking through an
installer, no manual restart. It then installs Nexus's own dependencies
(first run only) and launches the app.

Two things that can still happen, both handled with clear on-screen
instructions if they do:
- If your Windows doesn't have `winget` (rare — it ships with Windows 11
  by default), it'll tell you to install Node manually with a direct link.
- On some systems, even the automatic install still needs one restart
  before Windows can see it. If that happens, the script tells you exactly
  that, and running it again afterward picks up right where it left off.

## Alternative: manual setup (if you already have Node.js)

Open PowerShell in the Nexus folder, run `npm ci` once, then run
`npm start`. The primary `START-NEXUS.bat` launcher remains available for
people who prefer not to use the command line.

## Making a real installer (.exe) instead

If you'd rather have Nexus install like a normal Windows program — Start
Menu shortcut, Desktop icon, an actual uninstaller — double-click
**`build-installer.bat`**. It automatically installs dependencies if
needed, then builds a real installer using `electron-builder`. When it's
done, it opens the `dist` folder for you — look for a file ending in
`Setup.exe` and run that. From then on, launch Nexus like any other app on
your computer, no batch files or command line needed.

Building the installer takes longer than just running the app (it's
packaging the whole thing), so expect a couple of minutes the first time.

## Manual setup (if you prefer the command line)

<details>
<summary>Click to expand</summary>

```
cd C:\path\to\nexus-app
npm install
npm start
```

To build the installer manually instead of using the .bat file:

```
npm run dist
```

</details>

## Using it

Email account sign-up and encrypted email-vault sync require a one-time
Firebase project configuration. See **`FIREBASE_SETUP.md`** for the exact
Authentication and Firestore Rules setup. GitHub and Google sign-in continue
to work independently.

- **Projects tab:** Click **Browse…**, pick a real project folder on your
  computer, give it a name, set the start command (e.g. `npm run dev` for
  Vite/Next.js, or `npm start` for Create React App) and the port it runs
  on. Click **Save Project**, then **▶ Launch**.
  - **🛡️ Sandboxed (Docker):** check this on a project card before
    launching to run its start command inside an ephemeral Docker
    container instead of directly on your machine. The container only
    gets that project's own folder (plus a separate volume for
    `node_modules`, so container-built native modules never collide with
    host-installed ones) and the one port its dev server needs, published
    back to `localhost` so Preview still works. It cannot read or write
    anything else on your computer — not other projects, not Nexus
    itself. Needs Docker Desktop installed and running; the first launch
    is slower while it pulls the `node:20` image. This is a real boundary
    against a project (including AI-generated/AI-run code inside it)
    reaching outside its own folder — it is not a hardened security
    sandbox against a determined container escape, and it doesn't
    restrict network access by default.
- **Preview tab:** Once a project is running, this shows the actual live
  page plus its console output underneath.
- **Terminal tab:** A real terminal. Try `pwd`, `cd Desktop`, `dir` (or
  `ls` if you ever run this on Mac/Linux).
- **Cloud tab:** Add an NVIDIA NIM API key (get a free one at
  https://build.nvidia.com) — this powers Bug Fix Assist, Feature Builder,
  Feature Suggestions, Changelog generation, New Project generation, and
  Code Editor prompts. A Gemini key is optional, only for the separate
  "Ask Gemini" box. An OpenAI key is also optional, only for the "Ask
  OpenAI" box — it's there so Nexus's own AI tooling (and its metrics/cost
  tracking) stays usable if a project's own AI features ever move to
  OpenAI, not because anything else in Nexus depends on it.

## AI Code Assist tab (🩹)

- **Bug Fix Assist (NVIDIA NIM)** — pick "Active project" or "Nexus
  itself," pick a file, optionally paste an error, click **Analyze**. NIM
  proposes a fix and you see a full before/after — nothing is written to
  disk until you click **Approve**. A `.bak` backup of the original is
  always made first.
- **Fully autonomous toggle** — off by default, and it resets to off every
  time you restart the app (it's never saved to disk). Turning it on
  requires typing an exact confirmation phrase. When on, Analyze writes the
  fix immediately without showing you the diff first — use with caution.
  This same toggle also enables Feature Builder's "Run Remaining
  Autonomously" button in the Ship tab (see below) — one opt-in covers
  both, rather than two separate toggles to remember.
- **Feature Suggestions (NVIDIA NIM)** — reads your project's file list and
  `package.json` and lists ideas. This is read-only: there is no "apply"
  button anywhere in the code for this feature, on purpose.
- **Self-update** — same approve/reject flow, but pointed at Nexus's own
  source files. After approving a source change to Nexus itself, restart
  the development copy to see it take effect. Installed releases use the
  in-app GitHub Releases updater instead.

## Ship tab (🚀) — git, multi-file features, deploy

This is the piece that answers "can Nexus push new features to an
established app": partially automated, always human-gated at the two
points that matter (writing files, and touching git remote / running your
deploy script).

- **Git** — shows the active project's current branch and `git status`.
  Create a new branch before starting a feature (recommended — keeps
  changes off `main` until you're ready). **Commit & Push** stages
  everything, commits with your message, and pushes — it always asks you
  to confirm first, since this is the one action that reaches a real
  remote repository.
- **Feature Builder (NVIDIA NIM)** — describe a feature in plain language
  and NIM proposes a plan: which files need to change or be created, and
  what each change does (up to 6 files). Click **Generate & Review** on
  each plan item to get an actual proposed diff for that one file — same
  before/after review and Approve/Reject as Bug Fix Assist.
- **Run Remaining Autonomously** — appears once the "Fully autonomous"
  toggle in AI Assist is on. Generates AND applies every still-pending
  file in the plan with no per-file click, then runs the project's own
  guardrail/contract tests for real against the result. If they fail
  (and the project has any), every file this run touched is automatically
  reverted — restored to its exact prior content, or deleted if it was
  newly created — and reported as rolled back, never left half-applied or
  reported as a success it didn't earn. If the project has no guardrail
  scripts, the changes are kept (no guardrails to fail), same as
  everywhere else in Nexus that treats "no guardrails configured" as "no
  signal," not "passed."
- **Deploy** — enter whatever command you already use to ship (an
  `npm run deploy` script, a `bash deploy.sh`, an upload script, etc.),
  save it per-project, then **Run Deploy**. It runs your real script and
  streams the output. Also asks for confirmation first, since this can
  reach production.

What this does NOT do: there's no auto-deploy-on-push and no CI pipeline —
git push and deploy always require an explicit click regardless of the
autonomous toggle. That toggle now covers Bug Fix Assist's single-file
writes and Feature Builder's multi-file "Run Remaining Autonomously," but
never git remote operations or your deploy script.

## Changelog (also in the Ship tab)

Every time you approve a Bug Fix Assist or Feature Builder change, Nexus
quietly remembers a one-line summary of it (in memory, for that session —
it's not saved to disk on its own). Two ways to turn that into an actual
changelog:

- **On demand** — click **Generate Changelog Entry** any time. You'll see
  a preview of both a developer-facing entry and a plain-language,
  end-user-facing entry before anything is written.
- **At commit time** — if you have unlogged approved changes when you
  click **Commit & Push**, Nexus asks if you want to generate the entry
  first. If you say yes, it stops there so you can review and save it,
  then you click Commit & Push again to actually commit.

Either way, **Save to Files** is a separate click from generation — it
writes a dated entry to `CHANGELOG.md` (technical, Keep a Changelog style)
and `release-notes.md` (plain language, for end users) in the project
root, prepended above older entries. Saving clears the pending list for
that session.

Note: the pending list lives only in memory. If you close Nexus before
generating/saving a changelog, that session's list of "what changed" is
gone — the code changes themselves are still safely on disk (and backed
up as `.bak` files), just the changelog summary of them isn't.

## Project Config tab (🔐) — secrets, services, integrations

This is the piece that lets a project manage its own AI/API systems from
inside Nexus, instead of that project needing to build its own internal
admin dashboard.

- **Project Identity** — the first time you open this tab for a project,
  Nexus creates (or repairs) a `nexus.config.json` in that project's
  folder with a real `version` and a real `project_uid` (a UUID). This
  file has no secrets in it — it's just an identity so Nexus can scope
  everything else to this one project. If the file is missing or
  corrupted, Nexus regenerates a valid one rather than half-trusting a
  broken config.
- **This Project's Own API Keys / Secrets** — separate from Nexus's own
  NIM/Gemini keys. Add any key/value pair (e.g. `OPENAI_API_KEY`,
  `STRIPE_SECRET_KEY`, a database URL). Stored encrypted at rest, scoped
  to that project's `project_uid` — a different project can't see them. If
  OS-level encryption isn't available on a machine, saving is refused
  outright rather than silently falling back to plaintext.
- **Getting secrets into the actual project code** — two ways: (1) when
  you Launch a project or Start a service, Nexus automatically injects
  its saved secrets as real environment variables into that process — no
  file needed if your code reads `process.env`. (2) Click **Export to
  .env** to write them to a real `.env` file in the project (existing one
  backed up first) for tools that specifically need a `.env` file on disk.
- **Services** — for a project's own scrapers, workers, or local database
  processes. Give it a name, a start command, and (recommended) a health
  check URL. Status is always one of `IDLE` → `VERIFYING` → `ONLINE`, or
  `OFFLINE`/`RUNNING_UNVERIFIED` with the real error attached. Nexus never
  shows "Online" just because a process started — only after that health
  check URL actually returns a successful response. If you don't give a
  health check URL, it's honestly labeled `RUNNING_UNVERIFIED` rather than
  guessed at.
- **Detected Integrations** — a read-only scan of the active project's
  `package.json` dependencies and source files for common AI/API providers
  (OpenAI, Anthropic, Gemini, Stripe, Firebase, Supabase, AWS, Twilio,
  SendGrid, and a few more). Nothing is applied or changed — it's there so
  you (and Bug Fix Assist / Feature Builder) have visibility into what a
  project already depends on. (This scan looks for what a *scanned
  project* itself uses — unrelated to which provider powers Nexus's own
  AI features.)

## Pipeline: Audit → Repair → Test → Guardrails → Gate (in the Ship tab)

Click **Run Pipeline** on the active project to run `npm audit`, offer to
run `npm audit fix` if it finds issues (asks first — this modifies
dependency files), run the project's `npm test` script if one exists, then
run the project's own AI guardrail/contract/safety scripts (see AI Tools →
Guardrail Testing below). The **Gate** pill turns green only if the audit
passed (or was repaired), tests passed or were legitimately skipped (no
test script defined isn't treated as a failure), and guardrails passed or
were legitimately skipped (no matching scripts isn't treated as a
failure either). **Run Deploy** checks the gate first and asks you to
confirm if it hasn't passed — it doesn't hard-block, since not every
project has tests or guardrails configured, but it won't let a failing
gate slip by unnoticed.

**Run Tests** (the per-test detail card) gives structured per-test
pass/fail for Jest or Vitest projects. For a project that uses neither but
still has its own real `test:*` npm scripts (e.g. a project with
`test:contract`, `test:integration`, `test:firestore-rules` — whatever
names it actually defines), Nexus runs each one separately and shows real
per-script pass/fail instead of one opaque `npm test` blob. A project with
no Jest/Vitest and no `test:*` scripts falls back to plain `npm test`
output.

**Project Capabilities** (also in the Ship tab, under Deploy) detects
whether the active project is TypeScript/React/Vite/Express, uses
Firebase, or has a Capacitor mobile build, and lists that project's own
real npm scripts for each — nothing invented. Nexus has no dedicated
Firebase ops panel (no emulator control) or Capacitor tooling (no
Android/iOS emulator, no device preview); this only discovers what the
project already defines and runs it through the same Deploy flow as
everything else (confirm, then stream real output).

**Languages** (top of the Ship tab, above Commit History) shows a real
per-language byte breakdown of the active project's own source files —
the same idea as GitHub's repository "Languages" bar, including the
gray "Other" bucket for languages that individually make up less than
1% (folded together the same way GitHub does it, not hidden). It walks
the project's real files on disk and sums actual byte sizes per
language; it never estimates from file count or line count. Dependency
and build directories (`node_modules`, `dist`, `.git`, etc.) and
machine-generated files (lockfiles, `.min.js`, source maps, `*.d.ts`,
`*.generated.*`) are excluded, matching what GitHub's own Linguist
excludes from language stats. Refreshes automatically when you open the
Ship tab, or on demand via "↻ Scan Languages".

## Project Constitution (also in Project Config tab)

A project can have its own `CONSTITUTION.md` — governing rules for that
project specifically (e.g. "never fabricate telemetry," "unknown means
unknown," "no optimistic success states"). When this file exists, it's
not just a reference doc: **every prompt Nexus sends to NVIDIA NIM for
that project — Bug Fix Assist, Feature Builder's plan step, Feature
Builder's per-file generation, and Feature Suggestions — includes it and
is instructed to follow it strictly**, or explain in its response why it
couldn't.

- **Save to Project** writes whatever's in the text box to
  `CONSTITUTION.md` in the active project's root (existing file backed up
  to `.bak` first).
- **Reload from Disk** shows you what's currently saved.
- **Load Starter Template** fills the box with a generic governing-document
  template as a starting point — replace the bracketed notes with rules
  specific to your project, then Save to Project.

This only affects AI-proposed *content* — it can't force the pipeline
gate to physically block a build if a step is skipped, but a constitution
clause like "gate failures stop release" is exactly what the Ship tab's
Audit → Repair → Test → Gate pipeline already enforces mechanically.

## Notes / limits (so nothing surprises you)

- The terminal runs one command at a time and doesn't support interactive
  programs that need live input (like a text editor inside the terminal).
  Regular commands (build tools, git, npm, etc.) work fine.
- Stopping a project kills its process tree, but always double-check no
  process is left listening on a port if something looks stuck — Task
  Manager will show any leftover `node.exe`.
- API keys (NVIDIA NIM and Gemini) are stored encrypted using Windows'
  built-in credential encryption (via Electron's `safeStorage`), inside a
  small config file Nexus creates for itself — not in this project folder.
- NVIDIA NIM here means the **hosted API** at build.nvidia.com, not a
  self-hosted container — self-hosting real NIM containers needs
  enterprise/workstation-tier GPU hardware (NVIDIA's own support matrix
  shows a verified minimum of roughly 30GB VRAM even for the most
  memory-efficient coding-relevant model), which a typical consumer GPU
  doesn't have. The hosted API needs no local GPU at all.
- Windows installers are signed when the trusted Nexus certificate is
  available on the build machine. Use `npm run dist:local-signed` when you
  need the build to require and verify that local signing identity. Public
  distribution still benefits from a recognized commercial publisher
  certificate and reputation; a locally trusted certificate applies only
  to PCs where its public certificate has been trusted.

## If something goes wrong

- **`npm install` fails** — make sure you're connected to the internet and
  re-run the command; sometimes it's a flaky download.
- **App window opens blank/white** — open it again with dev tools by
  editing `main.js`, uncommenting the `openDevTools()` line near the top,
  and re-running `npm start` to see the error in the console.
- **"npm run dev" doesn't do anything when you Launch a project** — check
  that folder actually has a `package.json` with a `dev` script in it;
  otherwise use whatever command that specific project actually uses to
  start.
- **Bug Fix Assist / Feature Suggestions say no key saved** — add an
  NVIDIA NIM API key in the Cloud tab first; those features don't use
  Gemini.
- **Services show `RUNNING_UNVERIFIED` forever** — that's expected if you
  didn't give a health check URL. Add one (any endpoint that returns a
  2xx response when the service is actually ready) to get a real
  `ONLINE`/`OFFLINE` status instead.
- **`nexus.config.json` shows up in your project** — that's intentional
  and safe to commit; it only contains a version number and a random UUID,
  never any secret values.
