// complianceMonitor.js
// Main-process module: turns the guardrail-test run history that
// aiGuardrailTester already records into a compliance status - latest
// score, trend vs. the previous run, and a log of manually-flagged
// violations. It reads aiGuardrailTester's own run file rather than keeping
// a second copy of the same data, so the two can never drift out of sync.

const fs = require('fs');
const path = require('path');
const { getGuardrailHistory } = require('./aiGuardrailTester');

const VIOLATIONS_FILENAME = '.nexus-ai-compliance-violations.json';
const MAX_VIOLATIONS = 500;

function violationsPath(projectPath) {
  return path.join(projectPath, VIOLATIONS_FILENAME);
}

function loadViolations(projectPath) {
  const file = violationsPath(projectPath);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Manually logs a compliance violation (e.g. spotted during code review,
 * or reported by a user) that isn't necessarily caught by an automated test.
 */
function logViolation(projectPath, { rule, detail, severity }) {
  if (!rule) return { ok: false, error: 'rule is required.' };
  const violations = loadViolations(projectPath);
  violations.push({
    rule,
    detail: detail || '',
    severity: severity || 'medium',
    loggedAt: new Date().toISOString(),
  });
  fs.writeFileSync(violationsPath(projectPath), JSON.stringify(violations.slice(-MAX_VIOLATIONS), null, 2), 'utf8');
  return { ok: true };
}

/**
 * Returns the current compliance picture: latest automated guardrail score,
 * how it moved since the previous run, and recent manually-logged
 * violations.
 */
function getComplianceStatus(projectPath) {
  const runs = getGuardrailHistory(projectPath, 20); // newest first
  const latest = runs[0] || null;
  const previous = runs[1] || null;

  let trend = 'unknown';
  if (latest && previous && typeof latest.score === 'number' && typeof previous.score === 'number') {
    if (latest.score > previous.score) trend = 'improving';
    else if (latest.score < previous.score) trend = 'regressing';
    else trend = 'stable';
  } else if (latest) {
    trend = 'first-run';
  }

  const violations = loadViolations(projectPath).slice(-20).reverse();

  return {
    ok: true,
    hasGuardrailData: !!latest,
    latestScore: latest ? latest.score : null,
    previousScore: previous ? previous.score : null,
    trend,
    latestRunAt: latest ? latest.runAt : null,
    recentViolations: violations,
    openViolationCount: violations.length,
  };
}

module.exports = { getComplianceStatus, logViolation };
