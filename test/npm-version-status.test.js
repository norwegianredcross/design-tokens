const { test } = require('node:test');
const assert = require('node:assert/strict');
const { versionStatus } = require('../scripts/npm-version-status');

test('only a registry 404 permits publishing a checked-in version', async () => {
  assert.equal(await versionStatus('@norwegianredcross/design-tokens', '1.0.50', async () => ({ status: 404 })), 'unpublished');
  assert.equal(await versionStatus('@norwegianredcross/design-tokens', '1.0.49', async () => ({ status: 200, json: async () => ({ name: '@norwegianredcross/design-tokens', version: '1.0.49' }) })), 'published');
});
test('registry errors fail closed instead of treating the version as available', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(versionStatus('@norwegianredcross/design-tokens', '1.0.50', async () => ({ status })), /HTTP/);
  }
  await assert.rejects(versionStatus('@norwegianredcross/design-tokens', '1.0.50', async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(versionStatus('@norwegianredcross/design-tokens', '1.0.50', async () => ({ status: 200, json: async () => ({ name: 'wrong' }) })), /unexpected/);
});
