const { readFileSync } = require('node:fs');

// Only a registry 404 proves that a version is available. Authentication,
// rate-limit and network errors must stop the release, never trigger a bump.
async function versionStatus(name, version, fetchRegistry = fetch) {
  const response = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (response.status === 404) return 'unpublished';
  if (response.status !== 200) throw new Error(`npm registry returned HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.name !== name || metadata.version !== version) {
    throw new Error('npm registry returned unexpected package metadata');
  }
  return 'published';
}

module.exports = { versionStatus };
if (require.main === module) {
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
  versionStatus(name, version).then(console.log).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
