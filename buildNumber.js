const BUILD_NUMBER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const PUBLIC_LAUNCH_VERSION = '1.0.0';

function canonicalBuildNumber(value) {
  const match = BUILD_NUMBER_PATTERN.exec(String(value || ''));
  if (!match) return null;
  return `${Number(match[1])}.${Number(match[2])}.${String(Number(match[3])).padStart(2, '0')}`;
}

function normalizeBuildState(value) {
  const history = Array.isArray(value?.history) ? value.history
    .filter((entry) => entry && canonicalBuildNumber(entry.number))
    .map((entry) => ({ ...entry, number:canonicalBuildNumber(entry.number) }))
    .slice(-100) : [];
  const current = canonicalBuildNumber(value?.current);
  return { current, history };
}

function nextBuildNumber(current) {
  if (!current) return '0.0.03';
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

module.exports = { BUILD_NUMBER_PATTERN, PUBLIC_LAUNCH_VERSION, canonicalBuildNumber, normalizeBuildState, nextBuildNumber, approveNextBuild };
