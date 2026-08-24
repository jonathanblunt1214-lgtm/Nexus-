const test = require('node:test');
const assert = require('node:assert/strict');

const { isGitUrl, normalizeGitUrl, repoNameFromUrl } = require('../projectSourceInput');

test('project import accepts and normalizes common GitHub repository inputs', () => {
  const cases = [
    ['owner/repository', 'https://github.com/owner/repository'],
    ['github.com/owner/repository', 'https://github.com/owner/repository'],
    ['https://github.com/owner/repository', 'https://github.com/owner/repository'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(isGitUrl(input), true, input);
    assert.equal(normalizeGitUrl(input), expected, input);
    assert.equal(repoNameFromUrl(normalizeGitUrl(input)), 'repository', input);
  }
});

test('ordinary relative folders are not misidentified as GitHub repositories', () => {
  assert.equal(isGitUrl('./projects/my-app'), false);
  assert.equal(isGitUrl('../my-app'), false);
  assert.equal(isGitUrl('C:\\projects\\my-app'), false);
});
