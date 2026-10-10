const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const postcss = require('postcss');
const branch = require('./fixtures/figma-main.json');
const textStyles = branch.textStyles.map(s => ({...s, size: s.fontSize, font: s.fontName}));
const colorModes = require('./fixtures/figma-main-color-modes.json');
const collections = Object.fromEntries(branch.collections.map(c => [c.name, c]));
const variables = branch.variables.filter(v => branch.collections.some(c => c.id === v.collectionId));
const byId = Object.fromEntries(variables.map(v => [v.id, v]));
const members = name => variables.filter(v => v.collectionId === collections[name].id);
const read = file => fs.readFileSync(file, 'utf8');
function resolve(v, modes = {}, seen = []) {
  assert.ok(v, 'Figma variable must exist');
  assert.ok(!seen.includes(v.id), `Circular alias ${v.name}`);
  const c = branch.collections.find(c => c.id === v.collectionId);
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
function cssValue(value, values) {
  return value?.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(values[name], `Missing CSS reference ${name}`);
    return cssValue(values[name], values);
  });
}
const adapt = postcss.parse(read('styles/figma.css'));
const sizeNames = { medium: 'md', large: 'lg', small: 'sm' };

test('the snapshot contains every variable in all six local Figma collections', () => {
  assert.equal(variables.length, 910);
  assert.equal(new Set(variables.map(v => v.id)).size, 910);
  for (const c of branch.collections) assert.equal(members(c.name).length, c.count, c.name);
  for (const v of variables) for (const value of Object.values(v.values)) {
    if (value?.type === 'VARIABLE_ALIAS') assert.ok(byId[value.id], `${v.name}: alias target exists`);
  }
});
for (const theme of collections.Theme.modes.map(m => m.name)) {
  const css = postcss.parse(read(`design-tokens-build/digdir/${theme}.css`));
  for (const scheme of collections['Color scheme'].modes.map(m => m.name)) {
    test(`${theme}/${scheme}: every semantic color matches the Figma Main`, () => {
      const values = declarations(css, `ds.theme.color-scheme.${scheme.toLowerCase()}`);
      for (const v of members('Semantic').filter(v => v.type === 'COLOR')) {
        const prop = '--ds-' + v.name.replaceAll('/', '-');
        assert.equal(values[prop]?.toLowerCase(), resolve(v, { Theme: theme, 'Color scheme': scheme }), prop);
      }
    });
  }
  test(`${theme}: exact radii, border widths, opacity and typography modes`, () => {
    const values = declarations(css, 'ds.theme.semantic');
    for (const v of members('Semantic').filter(v => /^border-(width|radius)\//.test(v.name))) {
      const name = '--ds-' + v.name.replaceAll('/', '-');
      const raw = cssValue(values[name], values);
      assert.ok(raw, name);
      const px = parseFloat(raw) * (raw.endsWith('rem') ? 16 : 1);
      assert.equal(px, resolve(v, { Theme: theme }), name);
    }
    assert.equal(parseFloat(values['--ds-opacity-disabled']) / (values['--ds-opacity-disabled'].endsWith('%') ? 100 : 1), .3);
    for (const typography of collections.Typography.modes.map(m => m.name)) {
      const font = declarations(css, `ds.theme.typography.${typography.toLowerCase()}`);
      for (const v of members('Theme').filter(v => v.name === 'font-family' || v.name.startsWith('font-weight/'))) {
        const name = '--ds-' + v.name.replaceAll('/', '-');
        let expected = resolve(v, { Theme: theme, Typography: typography });
        expected = { Medium: '500', Regular: '400', 'Semi bold': '600', SemiBold: '600', Bold: '700' }[expected] ?? expected;
        assert.equal(font[name], expected, name);
      }
      for (const size of ['2xs','xs','sm','md','lg','xl','2xl']) assert.equal(font[`--ds-heading-${size}-font-weight`], '500');
    }
  });
  test(`${theme}: palette selectors reproduce every Figma Color mode`, () => {
    const values = declarations(css, 'ds.theme.color');
    const selectors = [];
    css.walkRules(r => selectors.push(r.selector));
    for (const mode of collections.Color.modes) {
      assert.ok(selectors.some(s => s.includes(`[data-color="${colorModes[mode.name]}"]`)), mode.name);
      const expected = Object.fromEntries(members('Color').map(v => [v.name, '{' + byId[v.values[mode.modeId].id].name.replaceAll('/','.') + '}']));
      const source = JSON.parse(read(`design-tokens/semantic/color/${colorModes[mode.name]}.json`));
      for (const [name,value] of Object.entries(expected)) assert.equal(source[name].$value, value);
      const contextual = {};
      css.walkRules(r => {
        if (r.selector.includes(`[data-color="${colorModes[mode.name]}"]`)) r.walkDecls(d => { contextual[d.prop] = d.value; });
      });
      for (const scheme of ['Light', 'Dark']) {
        const colors = declarations(css, `ds.theme.color-scheme.${scheme.toLowerCase()}`);
        for (const v of members('Color')) {
          const prop = `--ds-color-${v.name}`;
          assert.equal(cssValue(contextual[prop], colors), resolve(v, { Theme: theme, 'Color scheme': scheme, Color: mode.name }), `${theme}/${scheme}/${mode.name}/${v.name}`);
        }
      }
    }
    assert.ok(!read(`design-tokens-build/digdir/${theme}.css`).includes('undefined'));
  });
}
for (const mode of collections.Size.modes) {
  test(`${mode.name}: exact Figma font sizes and spacing in the shipped stylesheet`, () => {
    const expectedSelector = `[data-size="${sizeNames[mode.name]}"]`;
    const values = {};
    adapt.walkRules(r => { if(r.selector.includes(expectedSelector)) r.walkDecls(d => {values[d.prop]=d.value;}); });
    for (const v of members('Size').filter(v => v.name.startsWith('font-size/') || /^_size\/\d+$/.test(v.name))) {
      const prop = '--ds-' + v.name.replace('_size/', 'size/').replaceAll('/','-');
      assert.equal(parseFloat(values[prop]) * 16, v.values[mode.modeId], prop);
    }
  });
}
test('the token adapter contains variables only; components belong to rk-designsystem', () => {
  adapt.walkDecls(d => assert.ok(d.prop.startsWith('--ds-'), d.prop));
});
test('all 22 named text styles match Main size, weight, line height and tracking', () => {
  const css = postcss.parse(read('design-tokens-build/digdir/theme.css'));
  const values = {...declarations(css, 'ds.theme.type-scale'), ...declarations(css, 'ds.theme.semantic'), ...declarations(css, 'ds.theme.typography.primary')};
  adapt.walkRules(r => { if(r.selector.includes('[data-size="md"]')) r.walkDecls(d => { values[d.prop] = d.value; }); });
  for (const style of textStyles) {
    const prefix = '--ds-' + style.name.replace('typography/', '').replaceAll('/', '-');
    const value = suffix => cssValue(values[prefix + '-' + suffix], values);
    const size = parseFloat(value('font-size')) * 16;
    assert.equal(size, style.size, style.name + ' size');
    assert.equal(Number(value('font-weight')), style.font.variationSettings.wght, style.name + ' weight');
    assert.ok(Math.abs(Number(value('line-height')) * 100 - style.lineHeight.value) < .001, style.name + ' line height');
    assert.ok(Math.abs(parseFloat(value('letter-spacing')) * 100 - style.letterSpacing.value) < .001, style.name + ' tracking');
  }
});
test('existing package entry points include official output and Main size scales', () => {
  for (const theme of ['theme','konferansesenter']) {
    const entry=read(`design-tokens-build/${theme}.css`);
    assert.ok(entry.includes(`@import './digdir/${theme}.css'`));
    assert.ok(entry.includes("@import './figma.css'"));
    assert.match(entry, /--ds-font-family: "Source Sans 3"/);
    assert.ok(!entry.includes('Source Serif 4'));
  }
  assert.equal(read('styles/figma.css'),read('design-tokens-build/figma.css'));
  assert.equal(read('dist/figma.css'),read('styles/figma.css'));
  assert.equal(read('dist/brand-1.css'),read('design-tokens-build/theme.css'));
  for(const theme of ['theme','konferansesenter']) assert.equal(read(`dist/digdir/${theme}.css`),read(`design-tokens-build/digdir/${theme}.css`));
  assert.ok(!require('../package.json').scripts.build.includes('create:tokens'), 'normal build must preserve the Figma source tokens');
});
test('metadata and framework colors use Main rather than the Desktop export', () => {
  const metadata=JSON.parse(read('design-tokens-build/metadata.json'));
  assert.equal(metadata.tokens.light.color.danger.surface.tinted.value,'#ffe0e0');
  assert.equal(metadata.tokens.typography.header.font.family.value,'Source Sans 3');
  for(const file of ['shadcn-theme.css','bootstrap-theme.scss']) assert.ok(!read(`design-tokens-build/${file}`).includes('undefined'));
  assert.match(read('design-tokens-build/shadcn-theme.css'), /--primary: oklch\([^)]+\); \/\* #96171a \*\//i);
});

test('Main default context and compatibility aliases are compiled', () => {
  for (const theme of ['theme', 'konferansesenter']) {
    const css = postcss.parse(read(`design-tokens-build/digdir/${theme}.css`));
    let defaults;
    css.walkRules(r => {
      if (r.selector === ':root, [data-color-scheme], [data-color="hoved-beige"]') defaults = r;
    });
    assert.ok(defaults, 'Main default is Hoved · beige');
    for (const scheme of ['light', 'dark']) {
      const colors = declarations(css, `ds.theme.color-scheme.${scheme}`);
      for (const [legacy, current] of [['primary-color-red', 'red-cta'], ['secondary-color-rust', 'rust-main']]) {
        for (const v of members('Color')) assert.equal(colors[`--ds-color-${legacy}-${v.name}`], colors[`--ds-color-${current}-${v.name}`]);
      }
    }
  }
});
