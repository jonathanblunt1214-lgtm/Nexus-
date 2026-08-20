// aiPerformanceTuner.js
// Main-process module: real latency-based tuning suggestions, built
// entirely on aiMetrics.getLatencyPercentiles() (real p50/p90 computed from
// actually recorded call latencies - see aiMetrics.js). Distinct from
// aiRecommendations.js's latency comparison, which is one line among many
// mixed-topic recommendations; this module is specifically for someone
// tuning for speed and wants the full real latency profile per model, not
// just a single flagged pair.

const aiMetrics = require('./aiMetrics');

const MIN_SAMPLES = 5;

/**
 * Returns the real latency profile (p50/p90/max, from actually recorded
 * calls) for every model with enough samples, sorted fastest (by p50)
 * first, plus which one is the current fastest reliable option.
 */
function getPerformanceProfile(projectPath) {
  if (!projectPath) return { ok: false, error: 'No project folder.' };

  const percentiles = aiMetrics.getLatencyPercentiles(projectPath);
  const summary = aiMetrics.getMetricsSummary(projectPath);
  const successByModel = Object.fromEntries(summary.byModel.map((m) => [m.model, m.successRate]));

  const profile = percentiles
    .filter((p) => p.samples >= MIN_SAMPLES)
    .map((p) => ({ ...p, successRate: successByModel[p.model] ?? null }))
    .sort((a, b) => a.p50 - b.p50);

  const tooFewSamples = percentiles
    .filter((p) => p.samples < MIN_SAMPLES)
    .map((p) => ({ model: p.model, samples: p.samples }));

  let fastestReliable = null;
  const reliable = profile.filter((p) => p.successRate === null || p.successRate >= 90);
  if (reliable.length > 0) fastestReliable = reliable[0];

  return {
    ok: true,
    profile,
    tooFewSamples,
    fastestReliable,
    minSamplesRequired: MIN_SAMPLES,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { getPerformanceProfile };
