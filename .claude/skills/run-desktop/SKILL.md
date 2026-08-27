---
name: run-desktop
description: Build, run, and drive the Nexus Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, build it, or interact with its UI.
---

Nexus is an Electron desktop app (`main.js` + `index.html`, no bundler —
files load directly). For agent/automated use, drive it via the Playwright
REPL at `.claude/skills/run-desktop/driver.cjs` under xvfb.

## Prerequisites

`npm ci` installs everything needed, including `playwright-core` (devDependency,
used only by this driver — the app itself doesn't depend on it). System libs
(libnss3, libgbm1, libgtk-3-0, etc.) are already present in this environment's
base image.

The `electron` package's postinstall binary download intermittently crashes
with `AssertionError [ERR_ASSERTION] ... Parser.finish` (an undici bug through
the proxy) — if `node_modules/electron/dist/electron` doesn't exist after
`npm ci`, just retry: `node node_modules/electron/install.js`. Usually
succeeds on the 2nd attempt.

## Run (agent path)

```bash
xvfb-run -a node .claude/skills/run-desktop/driver.cjs
```

Wrap in tmux for interactive use:

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'xvfb-run -a node .claude/skills/run-desktop/driver.cjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 30 bash -c 'until tmux capture-pane -t app -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t app 'ss landing' Enter
tmux capture-pane -t app -p
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for windows |
| `ss [name]` | screenshot -> `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM (only works on the outer shell — see Gotchas) |
| `click-text <text>` | click button/link containing text (same limitation) |
| `mclick <x> <y>` | click via real OS-level mouse event at screen coords — use this for the sidebar/workspace UI |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the outer document, print JSON |
| `text [css-sel]` | print innerText |
| `windows` | list all windows + webContents |
| `quit` | close app, exit |

## Run (human path)

```bash
npm start   # opens a window; useless headless. Ctrl-C to quit.
```

## Gotchas

- **The visible workspace UI (sidebar nav with labels, Settings, project
  list, etc.) is NOT reachable via `document.querySelector`/`click`/`click-text`.**
  It renders inside a `<webview>` element (confirmed via `hasShadowRoot`)
  whose guest page Playwright's `_electron` does not expose as a separate
  `page` — `app.context().pages()` and `webContents.getAllWebContents()`
  both only ever show the outer `index.html` window, even after the webview
  has visibly loaded content. **Use `mclick <x> <y>` (real mouse events)
  instead of DOM queries** for anything in that visible workspace layer —
  coordinates from a screenshot work reliably since real input events go
  through Chromium's actual hit-testing, not JS DOM traversal.
- `document.body.innerText` on the outer document picks up stray icon
  glyphs (📁🧩📝 etc.) from an unrelated icon rail that also lives in the
  outer shell — don't use it to find visible workspace text.
- The outer shell (`index.html`) DOES have real, directly-clickable inputs
  for things like "Add a Project" (folder path, Save Project) — `click` and
  `type` work fine there. It's specifically the labeled sidebar/workspace
  panels (Settings & Keys, etc.) that live behind the webview.
- For testing `astEngine.js` (Tree-sitter) or `languageIntelligence.js`
  (TypeScript) specifically: it's more direct and more decisive to
  `require()` and call them straight from a Node script (see git history /
  session notes for an example) than to fight through the webview layer —
  the actual logic under test lives in those modules, not the UI chrome.

## Troubleshooting

- **Launch timeout (30s):** `node_modules/electron/dist/electron` missing —
  see Prerequisites, retry the install.
- **"Missing X server":** forgot `xvfb-run`.
- **Stale Xvfb locks / defunct Xvfb process left after a driver crash:**
  `pkill -f Xvfb; rm -f /tmp/.X*-lock`
