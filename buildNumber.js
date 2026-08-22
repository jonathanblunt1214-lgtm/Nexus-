const BUILD_NUMBER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function normalizeBuildState(value) {
  const history = Array.isArray(value?.history) ? value.history.filter((entry) => entry && BUILD_NUMBER_PATTERN.test(String(entry.number || ''))).slice(-100) : [];
  const current = BUILD_NUMBER_PATTERN.test(String(value?.current || '')) ? String(value.current) : null;
  return { current, history };
}

function nextBuildNumber(current) {
  if (!current) return '0.0.01';
  const match = BUILD_NUMBER_PATTERN.exec(String(current));
  if (!match) throw new Error('The saved build number is invalid.');
  const next = Number(match[3]) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('The build number cannot be incremented safely.');
  return `${Number(match[1])}.${Number(match[2])}.${String(next).padStart(2, '0')}`;
}

function approveNextBuild(state, { approved, commitHash = null, approvedAt = new Date().toISOString() } = {}) {
  if (approved !== true) throw new Error('Explicit user approval is required before assigning a build number.');
  const normalized = normalizeBuildState(state);
  const number = nextBuildNumber(normalized.current);
  return {
    current:number,
    history:[...normalized.history, { number, approvedAt, commitHash:commitHash || null }].slice(-100),
  };
}

module.exports = { BUILD_NUMBER_PATTERN, normalizeBuildState, nextBuildNumber, approveNextBuild };
