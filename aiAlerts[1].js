// aiAlerts.js
// Main-process module: real trend-based alerting over aiMetrics' own call
// history. This is deliberately NOT machine-learning "prediction" - it's
// arithmetic over two real, non-overlapping windows of already-recorded
// calls (a recent window vs. the window before it). If the recent window
// looks meaningfully worse than the prior one on a fixed, documented
// threshold, that's an alert; otherwise there is no alert. A model with too
// few recorded calls to form two windows is skipped rather than given a
// guessed trend.

const aiMetrics = require('./aiMetrics');

const WINDOW_SIZE = 10; // calls per comparison window
const MIN_TOTAL_FOR_TREND = WINDOW_SIZE * 2;
const FAILURE_RATE_JUMP_PCT = 15; // percentage-point increase to alert on
const LATENCY_RATIO_JUMP = 1.5; // recent avg latency / prior avg latency

function successRate(entries) {
  if (entries.length === 0) return null;
  return (entries.filter((e) => e.success).length / entries.length) * 100;
}

function avgLatency(entries) {
  const timed = entries.filter((e) => typeof e.latencyMs === 'number');
  if (timed.length === 0) return null;
  return timed.reduce((s, e) => s + e.latencyMs, 0) / timed.length;
}

/**
 * Returns { ok, alerts: [...] }. Each alert has { severity, title, detail,
 * basis }, same shape as aiRecommendations, so both can render in the same
 * list in the UI. Read-only - only ever reads aiMetrics' own persisted file.
 */
function getTrendAlerts(projectPath) {
  if (!projectPath) return { ok: false, error: 'No project folder.' };

  const history = aiMetrics.getMetricsHistory(projectPath, 5000); // newest first
  const byModel = {};
  for (const e of history) (byModel[e.model] = byModel[e.model] || []).push(e);

  const alerts = [];

  for (const [model, entriesNewestFirst] of Object.entries(byModel)) {
    if (entriesNewestFirst.length < MIN_TOTAL_FOR_TREND) continue;

    const recent = entriesNewestFirst.slice(0, WINDOW_SIZE); // most recent N calls
    const prior = entriesNewestFirst.slice(WINDOW_SIZE, WINDOW_SIZE * 2); // the N before that

    const recentSuccess = successRate(recent);
    const priorSuccess = successRate(prior);
    if (recentSuccess !== null && priorSuccess !== null && (priorSuccess - recentSuccess) >= FAILURE_RATE_JUMP_PCT) {
      alerts.push({
        severity: 'high',
        title: `${model}'s success rate just dropped`,
        detail: `Last ${WINDOW_SIZE} calls: ${recentSuccess.toFixed(1)}% success, vs ${priorSuccess.toFixed(1)}% in the ${WINDOW_SIZE} calls before that.`,
        basis: `aiMetrics history: model=${model}, recent window success=${recentSuccess.toFixed(1)}%, prior window success=${priorSuccess.toFixed(1)}%`,
      });
    }

    const recentLatency = avgLatency(recent);
    const priorLatency = avgLatency(prior);
    if (recentLatency !== null && priorLatency !== null && priorLatency > 0 && (recentLatency / priorLatency) >= LATENCY_RATIO_JUMP) {
      alerts.push({
        severity: 'medium',
        title: `${model} has gotten noticeably slower`,
        detail: `Last ${WINDOW_SIZE} calls averaged ${Math.round(recentLatency)}ms, vs ${Math.round(priorLatency)}ms in the ${WINDOW_SIZE} calls before that (${(recentLatency / priorLatency).toFixed(1)}x).`,
        basis: `aiMetrics history: model=${model}, recent window avg latency=${Math.round(recentLatency)}ms, prior window avg latency=${Math.round(priorLatency)}ms`,
      });
    }
  }

  return { ok: true, alerts, windowSize: WINDOW_SIZE, generatedAt: new Date().toISOString() };
}

module.exports = { getTrendAlerts };
