// aiCostOptimizer.js
// Main-process module: turns real recorded token usage (aiMetrics'
// tokensIn/tokensOut, populated automatically from each provider's own API
// response - see recordAiCallMetric in main.js) into real dollar figures.
//
// IMPORTANT: this module never guesses or hardcodes API pricing. Provider
// pricing changes over time and gets this wrong in a way that would mislead
// real spending decisions, so instead it asks the user to record their own
// current per-model price (from the provider's own pricing page) once via
// setPricing(), persists it locally, and only ever multiplies REAL recorded
// token counts by that REAL user-supplied number. A model with no pricing
// configured yet is reported as "pricing not set", never estimated.

const fs = require('fs');
const path = require('path');
const aiMetrics = require('./aiMetrics');

const PRICING_FILENAME = '.nexus-ai-pricing.json';

function pricingPath(projectPath) {
  return path.join(projectPath, PRICING_FILENAME);
}

function loadPricing(projectPath) {
  const file = pricingPath(projectPath);
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function savePricing(projectPath, pricing) {
  fs.writeFileSync(pricingPath(projectPath), JSON.stringify(pricing, null, 2), 'utf8');
}

/**
 * Records the user's own known price for a model, in USD per 1M tokens,
 * input and output priced separately (most providers price them
 * differently). Both numbers must be supplied by the user - there is no
 * default.
 */
function setPricing(projectPath, model, pricePerMillionIn, pricePerMillionOut) {
  if (!projectPath) return { ok: false, error: 'No project folder.' };
  if (!model) return { ok: false, error: 'model is required.' };
  if (!Number.isFinite(pricePerMillionIn) || !Number.isFinite(pricePerMillionOut)) {
    return { ok: false, error: 'pricePerMillionIn and pricePerMillionOut must both be numbers (USD per 1,000,000 tokens).' };
  }
  const pricing = loadPricing(projectPath);
  pricing[model] = { pricePerMillionIn, pricePerMillionOut, setAt: new Date().toISOString() };
  savePricing(projectPath, pricing);
  return { ok: true, pricing: pricing[model] };
}

function getPricing(projectPath) {
  return { ok: true, pricing: loadPricing(projectPath) };
}

/**
 * Computes real cost per model from real recorded token totals x
 * user-supplied pricing. Models with no pricing configured are listed
 * separately under `unpriced` rather than silently skipped or guessed.
 */
function estimateCosts(projectPath) {
  if (!projectPath) return { ok: false, error: 'No project folder.' };
  const pricing = loadPricing(projectPath);
  const summary = aiMetrics.getMetricsSummary(projectPath);

  const priced = [];
  const unpriced = [];

  for (const m of summary.byModel) {
    const rate = pricing[m.model];
    if (!rate) {
      unpriced.push({ model: m.model, calls: m.calls, totalTokensIn: m.totalTokensIn, totalTokensOut: m.totalTokensOut });
      continue;
    }
    if (m.totalTokensIn === null && m.totalTokensOut === null) {
      unpriced.push({ model: m.model, calls: m.calls, reason: 'no token counts recorded for this model yet' });
      continue;
    }
    const costIn = ((m.totalTokensIn || 0) / 1_000_000) * rate.pricePerMillionIn;
    const costOut = ((m.totalTokensOut || 0) / 1_000_000) * rate.pricePerMillionOut;
    priced.push({
      model: m.model,
      calls: m.calls,
      totalTokensIn: m.totalTokensIn,
      totalTokensOut: m.totalTokensOut,
      costUsd: +(costIn + costOut).toFixed(4),
      successRate: m.successRate,
    });
  }

  priced.sort((a, b) => b.costUsd - a.costUsd);

  // Recommend the cheapest RELIABLE model against the single most expensive
  // model actually in use - the "most expensive" side doesn't itself need to
  // be reliable (an expensive model that's also unreliable is exactly the
  // case worth flagging loudest). Needs at least one reliable priced model
  // to compare from, and needs it to actually be a different, cheaper model.
  let recommendation = null;
  const reliable = priced.filter((p) => p.successRate === null || p.successRate >= 90);
  if (reliable.length >= 1 && priced.length >= 2) {
    const cheapest = [...reliable].sort((a, b) => a.costUsd - b.costUsd)[0];
    const mostExpensive = priced[0];
    if (cheapest.model !== mostExpensive.model && mostExpensive.costUsd > cheapest.costUsd) {
      recommendation = {
        title: `${cheapest.model} costs less than ${mostExpensive.model}${mostExpensive.successRate !== null && mostExpensive.successRate < 90 ? ' and is more reliable' : ' at a comparable success rate'}`,
        detail: `${cheapest.model}: $${cheapest.costUsd} over ${cheapest.calls} calls (${cheapest.successRate ?? 'n/a'}% success) vs ${mostExpensive.model}: $${mostExpensive.costUsd} over ${mostExpensive.calls} calls (${mostExpensive.successRate ?? 'n/a'}% success).`,
      };
    }
  }

  return { ok: true, priced, unpriced, recommendation, generatedAt: new Date().toISOString() };
}

module.exports = { setPricing, getPricing, estimateCosts };
