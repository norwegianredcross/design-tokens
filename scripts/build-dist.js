const fs = require('node:fs');
const path = require('node:path');

// Only copy generated artifacts. Never alter Digdir's CSS or append overrides.
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
fs.copyFileSync('designsystemet.config.json', 'design-tokens-build/designsystemet.config.json');
for (const [source, target] of Object.entries({
  'theme.css': 'brand-1.css',
  'shadcn-theme.css': 'shadcn-theme.css',
  'types.d.ts': 'types.d.ts',
  'colors.d.ts': 'colors.d.ts',
})) {
  fs.copyFileSync(path.join('design-tokens-build', source), path.join('dist', target));
}
