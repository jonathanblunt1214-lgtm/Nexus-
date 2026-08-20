# Nexus AI Improvement Framework

## Goal

Give Nexus a set of generic, working tools for inventorying, measuring, testing, and safely upgrading the AI parts of *whatever project is open* - not tied to any one project's AI stack or vocabulary.

## What's implemented

Each module below is a real, working main-process file (no placeholders), wired into `preload.js` (as `window.nexus.aiFw*`) and `main.js` (as `ai-fw-*` IPC channels), with a UI in the "AI Tools" panel (🧠 in the sidebar, or "Open AI Tools" in the command palette).

- **`aiInventory.js`** - scans the active project for AI models, required API keys, config files, and guardrail files in use. Read-only.
- **`aiMetrics.js`** - records and summarizes real AI call metrics (latency, cost, success/failure) per project, persisted to `.nexus-ai-metrics.json` in the project folder.
- **`aiGuardrailTester.js`** - finds and runs a project's own guardrail/contract/safety/compliance npm scripts and reports real pass/fail results and a score.
- **`aiUpgradeOrchestrator.js`** - applies a literal find/replace to one config file (e.g. swapping a model identifier), then keeps the change only if the project's own guardrail tests and lint script still pass - otherwise it rolls back automatically.
- **`promptTesting.js`** - lets a project keep named prompt variants and record quality scores against them over time.
- **`dependencyAuditor.js`** - checks installed vs. latest version for AI-related npm dependencies (best-effort; degrades gracefully offline).
- **`complianceMonitor.js`** - turns the guardrail run history into a compliance status (latest score, trend, logged violations).
- **`changelogGenerator.js`** - filters a project's real git history down to commits that touch AI-related files or mention AI-related terms.
- **`knowledgeBase.js`** - a small cross-project store (`~/.nexus-ai-knowledge-base.json`) for lessons learned, so patterns carry forward into the next project.
- **`experimentationFramework.js`** - side-by-side (A/B) comparison of two variants using real recorded numeric observations, with a conservative "insufficient data" / "no clear difference" / "clear difference" verdict.

## Design notes

- Every module operates on real files/processes in the active project folder. None of them fabricate data - a project with no guardrail scripts gets `hasGuardrails: false`, not an invented score.
- Guardrail tests and lint run via `execFile` with an argv array (no shell), consistent with the rest of Nexus's process handling.
- `aiUpgradeOrchestrator` refuses to touch any path outside the project folder, and only ever does a literal (non-regex) substring replace.
- None of this is specific to any one project's AI stack, model names, or terminology - `aiInventory`'s model-detection patterns are generic (Gemini, Claude, GPT, NVIDIA NIM, local/Ollama), and the guardrail/config file matchers look for common naming conventions, not one project's specific file names.

## Possible next steps

- A metrics/compliance trend chart in the AI Tools panel (currently JSON-only output).
- Wiring `aiMetrics.recordMetric` automatically into Nexus's own Gemini/NIM call sites, so Nexus's own AI usage shows up without a manual call.
- A "suggested next experiment" helper that reads `knowledgeBase` entries to propose what to A/B test next.
