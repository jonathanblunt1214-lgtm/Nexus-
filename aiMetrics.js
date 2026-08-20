// aiMetrics.js
// Main-process module: records and summarizes real AI call metrics (latency,
// cost, success/failure) per project, persisted to a small JSON file inside
// the project folder so history survives restarts. Nothing here is
// synthetic - every entry comes from an actual recorded event; a project
// with no recorded calls has an empty history, not fabricated numbers.

const fs = require('fs');
const path = require('path');

const METRICS_FILENAME = '.nexus-ai-metrics.json';
const MAX_ENTRIES = 5000;

function metricsPath(projectPath) {
  return path.join(projectPath, METRICS_FILENAME);
}

function loadMetrics(projectPath) {
  const file = metricsPath(projectPath);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveMetrics(projectPath, entries) {
  const file = metricsPath(projectPath);
  const trimmed = entries.slice(-MAX_ENTRIES);
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

/**
 * Records one real AI call event.
 * event: { model, latencyMs, costUsd, success, errorMessage, tag, tokensIn, tokensOut }
 * tokensIn/tokensOut should only ever be real counts read back from a
 * provider's own API response (e.g. NIM's OpenAI-compatible `usage` object,
 * Gemini's `usageMetadata`) - never estimated or invented. Leave them out
 * when the provider didn't report them.
 */
function recordMetric(projectPath, event) {
  if (!event || typeof event.model !== 'string') {
    return { ok: false, error: 'model is required.' };
  }
  const entries = loadMetrics(projectPath);
  const entry = {
    model: event.model,
    latencyMs: Number.isFinite(event.latencyMs) ? event.latencyMs : null,
    costUsd: Number.isFinite(event.costUsd) ? event.costUsd : null,
    tokensIn: Number.isFinite(event.tokensIn) ? event.tokensIn : null,
    tokensOut: Number.isFinite(event.tokensOut) ? event.tokensOut : null,
    success: event.success !== false,
    errorMessage: event.success === false ? (event.errorMessage || 'unknown error') : null,
    tag: event.tag || null,
    recordedAt: new Date().toISOString(),
  };
  entries.push(entry);
  saveMetrics(projectPath, entries);
  return { ok: true, entry };
}

function summarizeByModel(entries) {
  const byModel = {};
  for (const e of entries) {
    if (!byModel[e.model]) {
      byModel[e.model] = {
        model: e.model, calls: 0, successes: 0, failures: 0,
        totalLatencyMs: 0, latencyCount: 0, totalCostUsd: 0,
        totalTokensIn: 0, totalTokensOut: 0, tokenCount: 0,
      };
    }
    const s = byModel[e.model];
    s.calls += 1;
    if (e.success) s.successes += 1; else s.failures += 1;
    if (typeof e.latencyMs === 'number') { s.totalLatencyMs += e.latencyMs; s.latencyCount += 1; }
    if (typeof e.costUsd === 'number') s.totalCostUsd += e.costUsd;
    if (typeof e.tokensIn === 'number' || typeof e.tokensOut === 'number') {
      s.totalTokensIn += e.tokensIn || 0;
      s.totalTokensOut += e.tokensOut || 0;
      s.tokenCount += 1;
    }
  }
  return Object.values(byModel).map((s) => ({
    model: s.model,
    calls: s.calls,
    successRate: s.calls ? +(s.successes / s.calls * 100).toFixed(1) : null,
    avgLatencyMs: s.latencyCount ? Math.round(s.totalLatencyMs / s.latencyCount) : null,
    totalCostUsd: +s.totalCostUsd.toFixed(4),
    totalTokensIn: s.tokenCount ? s.totalTokensIn : null,
    totalTokensOut: s.tokenCount ? s.totalTokensOut : null,
  }));
}

/**
 * Real latency percentiles per model (p50/p90), computed from actually
 * recorded latencies only - models with fewer than 2 timed calls are
 * omitted rather than given a misleading single-sample "percentile".
 */
function getLatencyPercentiles(projectPath) {
  const entries = loadMetrics(projectPath).filter((e) => typeof e.latencyMs === 'number');
  const byModel = {};
  for (const e of entries) {
    (byModel[e.model] = byModel[e.model] || []).push(e.latencyMs);
  }
  const pct = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };
  return Object.entries(byModel)
    .filter(([, arr]) => arr.length >= 2)
    .map(([model, arr]) => ({
      model,
      samples: arr.length,
      p50: pct(arr, 50),
      p90: pct(arr, 90),
      max: Math.max(...arr),
    }));
}

/**
 * Returns an aggregate summary of everything recorded for a project.
 */
function getMetricsSummary(projectPath) {
  const entries = loadMetrics(projectPath);
  return {
    projectPath,
    totalCalls: entries.length,
    byModel: summarizeByModel(entries),
    lastRecordedAt: entries.length ? entries[entries.length - 1].recordedAt : null,
  };
}

function getMetricsHistory(projectPath, limit = 100) {
  const entries = loadMetrics(projectPath);
  return entries.slice(-limit).reverse();
}

module.exports = { recordMetric, getMetricsSummary, getMetricsHistory, getLatencyPercentiles };
