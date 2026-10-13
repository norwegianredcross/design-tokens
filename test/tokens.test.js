const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const postcss = require('postcss');
const snapshot = require('./fixtures/figma-main.json');
const colorModes = require('./fixtures/figma-main-color-modes.json');
const config = require('../designsystemet.config.json');
const { buildSizeValues } = require('../scripts/build-size-values');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'node_modules/.bin/designsystemet');
const read = file => fs.readFileSync(file, 'utf8');
const byId = Object.fromEntries(snapshot.variables.map(v => [v.id, v]));
const collections = Object.fromEntries(snapshot.collections.map(c => [c.name, c]));
const members = name => snapshot.variables.filter(v => v.collectionId === collections[name].id);
function resolve(v, modes, seen = []) {
  assert.ok(v && !seen.includes(v.id), 'valid, non-circular snapshot alias');
  const c = snapshot.collections.find(c => c.id === v.collectionId);
  const mode = c.modes.find(m => m.name === modes[c.name]) ?? c.modes.find(m => m.modeId === c.defaultModeId);
  const value = v.values[mode.modeId];
  return value?.type === 'VARIABLE_ALIAS' ? resolve(byId[value.id], modes, [...seen, v.id]) : value;
}
function declarations(css, layerName) {
  const values = {};
  css.walkAtRules('layer', layer => {
    if (layer.params === layerName) layer.walkDecls(d => { values[d.prop] = d.value; });
  });
  return values;
}
function tree(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort()
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .map(f => [f, read(path.join(dir, f))]));
}
function generate(dir) {
  execFileSync(cli, ['tokens', 'build', '--config', 'designsystemet.config.json', '--out-dir', 'design-tokens-build', '--clean'], { cwd: dir, stdio: 'pipe' });
}

test('all 919 live Main source variables match their Figma values in every mode', () => {
  execFileSync(process.execPath, ['scripts/audit-main-variables.js'], { cwd: root, stdio: 'pipe' });
  const audit = JSON.parse(read('audit/main-source-correction/all-variable-checks.json'));
  assert.equal(audit.variables, 919);
  assert.deepEqual(audit.failures, []);
});

test('build preserves Digdir structure and compiles our source values reproducibly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-main-build-'));
  try {
    fs.copyFileSync('designsystemet.config.json', path.join(dir, 'designsystemet.config.json'));
    fs.cpSync('design-tokens', path.join(dir, 'design-tokens'), { recursive: true });
    const before = tree(path.join(dir, 'design-tokens'));
    generate(dir);
    assert.deepEqual(tree(path.join(dir, 'design-tokens')), before);
    // Only values of existing size declarations may differ from official output.
    const structure = text => {
      const ast = postcss.parse(text);
      ast.walkDecls(d => { if (/^--ds-(font-size|size)-\d+$/.test(d.prop)) d.value = 'SIZE_VALUE'; });
      return ast.toString();
    };
    for (const theme of ['theme', 'konferansesenter']) {
      assert.equal(structure(read(path.join(dir, 'design-tokens-build', theme + '.css'))), structure(read(`design-tokens-build/${theme}.css`)));
    }
    buildSizeValues(path.join(dir, 'design-tokens'), path.join(dir, 'design-tokens-build'));
    for (const f of ['theme.css', 'konferansesenter.css', 'types.d.ts', 'colors.d.ts']) {
      assert.equal(read(path.join(dir, 'design-tokens-build', f)), read(path.join('design-tokens-build', f)), f);
    }
    fs.writeFileSync(path.join(dir, 'design-tokens-build/figma.css'), ':root { --ds-size-4: 999px; }');
    const file = path.join(dir, 'design-tokens/semantic/style.json');
    const semantic = JSON.parse(read(file));
    semantic['border-width'].default.$value = '7px';
    fs.writeFileSync(file, JSON.stringify(semantic));
    const sizesFile = path.join(dir, 'design-tokens/primitives/modes/typography/size/small.json');
    const sizes = JSON.parse(read(sizesFile));
    sizes['font-size']['2'].$value = 17;
    fs.writeFileSync(sizesFile, JSON.stringify(sizes));
    generate(dir);
    buildSizeValues(path.join(dir, 'design-tokens'), path.join(dir, 'design-tokens-build'));
    assert.ok(!fs.existsSync(path.join(dir, 'design-tokens-build/figma.css')));
    const css = postcss.parse(read(path.join(dir, 'design-tokens-build/theme.css')));
    assert.equal(declarations(css, 'ds.theme.semantic')['--ds-border-width-default'], '7px');
    assert.ok(declarations(css, 'ds.theme.type-scale')['--ds-font-size-2'].includes('var(--ds-size--sm, 1.0625rem)'), 'the build reads changed size values from JSON');
    assert.ok(!require('../package.json').scripts.build.includes('create:tokens'), 'building must not reset customized sources');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const theme of Object.keys(config.themes)) {
  const css = postcss.parse(read(`design-tokens-build/${theme}.css`));
  for (const scheme of ['light', 'dark']) {
    test(`${theme}/${scheme}: Main semantic and contextual colors compile correctly`, () => {
      const colors = declarations(css, `ds.theme.color-scheme.${scheme}`);
      const modes = { Theme: theme, 'Color scheme': scheme === 'light' ? 'Light' : 'Dark' };
      for (const v of members('Semantic').filter(v => v.type === 'COLOR')) {
        assert.equal(colors['--ds-' + v.name.replaceAll('/', '-')], resolve(v, modes), v.name);
      }
      for (const mode of collections.Color.modes) {
        const name = colorModes[mode.name];
        const context = {};
        css.walkRules(r => {
          if (r.selector.includes(`[data-color="${name}"]`)) r.walkDecls(d => { context[d.prop] = d.value; });
        });
        for (const v of members('Color')) {
          const prop = `--ds-color-${v.name}`;
          const reference = context[prop]?.match(/^var\((--[\w-]+)\)$/)?.[1];
          assert.equal(colors[reference], resolve(v, { ...modes, Color: mode.name }), `${mode.name}/${v.name}`);
        }
      }
    });
  }
  test(`${theme}: quoted Source Sans 3 and legacy palette names survive generation`, () => {
    for (const mode of ['primary', 'secondary', 'header']) {
      assert.equal(declarations(css, `ds.theme.typography.${mode}`)['--ds-font-family'], '"Source Sans 3"');
    }
    for (const scheme of ['light', 'dark']) {
      const colors = declarations(css, `ds.theme.color-scheme.${scheme}`);
      for (const [legacy, current] of [['primary-color-red', 'red-cta'], ['secondary-color-rust', 'rust-main']]) {
        for (const v of members('Color')) assert.equal(colors[`--ds-color-${legacy}-${v.name}`], colors[`--ds-color-${current}-${v.name}`]);
      }
    }
  });
}

test('package entry points are standalone generated CSS with no Figma adapter', () => {
  for (const theme of ['theme', 'konferansesenter']) {
    const css = postcss.parse(read(`design-tokens-build/${theme}.css`));
    css.walkAtRules('import', rule => assert.fail(`unexpected import ${rule.params}`));
    assert.ok(!read(`design-tokens-build/${theme}.css`).includes('undefined'));
  }
  assert.equal(read('dist/brand-1.css'), read('design-tokens-build/theme.css'));
  assert.equal(read('design-tokens-build/designsystemet.config.json'), read('designsystemet.config.json'));
  for (const dir of ['dist', 'design-tokens-build']) {
    assert.ok(!fs.existsSync(`${dir}/figma.css`));
    assert.ok(!fs.existsSync(`${dir}/digdir`));
  }
});

test('derived framework outputs and metadata read the generated public theme', () => {
  const metadata = JSON.parse(read('design-tokens-build/metadata.json'));
  assert.equal(metadata.tokens.light.color.danger.surface.tinted.value, '#ffe0e0');
  assert.equal(metadata.tokens.typography.primary.font.family.value, '"Source Sans 3"');
  for (const file of ['shadcn-theme.css', 'bootstrap-theme.scss']) assert.ok(!read(`design-tokens-build/${file}`).includes('undefined'));
  assert.match(read('design-tokens-build/shadcn-theme.css'), /--primary: oklch\([^)]+\); \/\* #96171a \*\//i);
  assert.match(read('design-tokens-build/bootstrap-theme.scss'), /\$light-primary: #96171a;/i);
});
