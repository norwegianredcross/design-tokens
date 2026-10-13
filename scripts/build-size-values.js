// Digdir's compiler derives every size from the medium scale. Our source tokens
// contain explicit values for each size mode. Compile those values using the
// same mode switches that Digdir emits, without adding selectors or stylesheets.
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

function flatten(object, prefix = '', values = {}) {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      if ('$value' in value) values[name] = value.$value;
      else flatten(value, name, values);
    }
  }
  return values;
}

function resolveNumber(name, values, seen = []) {
  if (seen.includes(name) || !(name in values)) throw Error(`Invalid size alias: ${name}`);
  const value = String(values[name]).replace(/\{([^}]+)\}/g, (_, ref) =>
    `(${resolveNumber(ref, values, [...seen, name])})`);
  // Only numeric arithmetic and floor(), as used by Digdir's token sources.
  // No identifiers, property access, strings or statements are accepted.
  if (!/^(?:floor|[\d.\s()+*/-])+$/.test(value)) throw Error(`Unsupported size expression: ${name} = ${value}`);
  const number = Function('floor', `"use strict"; return (${value});`)(Math.floor);
  if (!Number.isFinite(number) || number < 0) throw Error(`Invalid size value: ${name}`);
  return number;
}

function compileSizes(tokensDir) {
  const themes = JSON.parse(fs.readFileSync(path.join(tokensDir, '$themes.json'), 'utf8'));
  const shortNames = { small: 'sm', medium: 'md', large: 'lg' };
  const modes = themes.filter(t => t.group.toLowerCase() === 'size');
  if (modes.length !== 3) throw Error('Expected the three Digdir size modes');
  const valuesByMode = modes.map(mode => {
    const short = shortNames[mode.name];
    if (!short) throw Error(`Unsupported size mode: ${mode.name}`);
    const values = {};
    for (const [set, state] of Object.entries(mode.selectedTokenSets)) {
      if (state !== 'disabled') flatten(JSON.parse(fs.readFileSync(path.join(tokensDir, `${set}.json`), 'utf8')), '', values);
    }
    return { short, values };
  });
  const expressions = {};
  for (const name of Object.keys(valuesByMode[0].values)) {
    if (!/^(font-size|_size)\.\d+$/.test(name)) continue;
    const cssName = '--ds-' + name.replace(/^_size/, 'size').replaceAll('.', '-');
    expressions[cssName] = valuesByMode.map(({ short, values }) =>
      `var(--ds-size--${short}, ${resolveNumber(name, values) / 16}rem)`).join(' ');
  }
  return expressions;
}

function buildSizeValues(tokensDir = 'design-tokens', outputDir = 'design-tokens-build') {
  const expressions = compileSizes(tokensDir);
  for (const file of fs.readdirSync(outputDir).filter(f => f.endsWith('.css'))) {
    const output = path.join(outputDir, file);
    const css = postcss.parse(fs.readFileSync(output, 'utf8'));
    const found = new Set();
    const switches = new Set();
    css.walkDecls(decl => {
      if (/^--ds-size--(sm|md|lg)$/.test(decl.prop)) switches.add(decl.prop);
      if (decl.prop in expressions) {
        decl.value = expressions[decl.prop];
        found.add(decl.prop);
      }
    });
    if (switches.size !== 3 || found.size !== Object.keys(expressions).length) {
      throw Error(`Unexpected Digdir output structure in ${file}; refusing to write size values`);
    }
    fs.writeFileSync(output, css.toString());
  }
}

if (require.main === module) buildSizeValues();
module.exports = { buildSizeValues, compileSizes };
