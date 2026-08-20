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
 * event: { model, latencyMs, costUsd, success, errorMessage, tag }
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
      byModel[e.model] = { model: e.model, calls: 0, successes: 0, failures: 0, totalLatencyMs: 0, latencyCount: 0, totalCostUsd: 0 };
    }
    const s = byModel[e.model];
    s.calls += 1;
    if (e.success) s.successes += 1; else s.failures += 1;
    if (typeof e.latencyMs === 'number') { s.totalLatencyMs += e.latencyMs; s.latencyCount += 1; }
    if (typeof e.costUsd === 'number') s.totalCostUsd += e.costUsd;
  }
  return Object.values(byModel).map((s) => ({
    model: s.model,
    calls: s.calls,
    successRate: s.calls ? +(s.successes / s.calls * 100).toFixed(1) : null,
    avgLatencyMs: s.latencyCount ? Math.round(s.totalLatencyMs / s.latencyCount) : null,
    totalCostUsd: +s.totalCostUsd.toFixed(4),
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

module.exports = { recordMetric, getMetricsSummary, getMetricsHistory };
