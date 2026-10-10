// Import the reviewed MCP snapshot into Digdir sources. Generated CSS is built separately.
const fs = require('node:fs');
const path = require('node:path');
const main = require('../test/fixtures/figma-main.json');
const collections = Object.fromEntries(main.collections.map(c => [c.name, c]));
const byId = Object.fromEntries(main.variables.map(v => [v.id, v]));
const members = name => main.variables.filter(v => v.collectionId === collections[name].id);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const set = (obj, name, value) => { const keys = name.split('/'); const last = keys.pop(); for (const key of keys) obj = obj[key] ??= {}; obj[last] = value; };
const ref = value => value?.type === 'VARIABLE_ALIAS' ? '{' + byId[value.id].name.replaceAll('/', '.') + '}' : value;
function resolve(v, modes = {}) {
  const c = main.collections.find(c => c.id === v.collectionId);
  const mode = c.modes.find(m => m.name === modes[c.name]) ?? c.modes.find(m => m.modeId === c.defaultModeId);
  const value = v.values[mode.modeId];
  return value?.type === 'VARIABLE_ALIAS' ? resolve(byId[value.id], modes) : value;
}
const modeNames = {
  'Hoved · beige': 'hoved-beige', 'Hoved · rosa': 'hoved-rosa',
  'Hoved · mint': 'hoved-mint', 'Hoved · lyseblå': 'hoved-lysebla',
  'Hoved Nøytral': 'hoved-neutral', 'Nøytral': 'neutral',
  Danger: 'danger', Warning: 'warning', Success: 'success', Info: 'info',
};
write('test/fixtures/figma-main-color-modes.json', modeNames);
const token = (v, value) => ({ $type: v.type === 'COLOR' ? 'color' : v.name.includes('font-family') ? 'fontFamilies' : v.name.includes('font-weight') ? 'fontWeights' : v.type === 'STRING' ? 'string' : 'dimension', $value: ref(value) });
for (const mode of collections['Color scheme'].modes) {
  const sources = { theme: {}, konferansesenter: {} };
  for (const v of members('Color scheme')) set(sources[v.name.startsWith('konferansesenter/') ? 'konferansesenter' : 'theme'], v.name, token(v, v.values[mode.modeId]));
  for (const [theme, source] of Object.entries(sources)) write(`design-tokens/primitives/modes/color-scheme/${mode.name.toLowerCase()}/${theme}.json`, source);
}
for (const mode of collections.Typography.modes) {
  for (const theme of ['theme', 'konferansesenter']) {
    const source = {};
    for (const v of members('Typography').filter(v => v.name.startsWith(theme + '/'))) set(source, v.name, token(v, v.values[mode.modeId]));
    write(`design-tokens/primitives/modes/typography/${mode.name.toLowerCase()}/${theme}.json`, source);
  }
}
for (const mode of collections.Theme.modes) {
  const source = {};
  for (const v of members('Theme')) set(source, v.name, token(v, v.values[mode.modeId]));
  write(`design-tokens/themes/${mode.name}.json`, source);
}
const semantic = read('design-tokens/semantic/style.json');
semantic.color = {};
for (const v of members('Semantic')) {
  if (v.type === 'COLOR') set(semantic, v.name, token(v, Object.values(v.values)[0]));
  else if (v.name.startsWith('border-width/')) set(semantic, v.name, token(v, Object.values(v.values)[0]));
}
// Retain existing public names as aliases to Main's renamed palettes.
for (const [oldName, newName] of Object.entries({ 'primary-color-red': 'red-cta', 'secondary-color-rust': 'rust-main' })) {
  semantic.color[oldName] = Object.fromEntries(Object.keys(semantic.color[newName]).map(role => [role, { $type: 'color', $value: `{color.${newName}.${role}}` }]));
}
// Main moved visited into color/link; preserve the old --ds-link-visited export.
semantic.link.visited = { $type: 'color', $value: '{color.link.visited}' };
write('design-tokens/semantic/style.json', semantic);
const themes = read('design-tokens/$themes.json').filter(t => t.group !== 'Color');
const colorThemes = [];
for (const mode of collections.Color.modes) {
  const name = modeNames[mode.name];
  const source = {};
  for (const v of members('Color')) source[v.name] = token(v, v.values[mode.modeId]);
  // Digdir emits contextual selectors from semantic color namespaces.
  if (name.startsWith('hoved-')) semantic.color[name] = source;
  write(`design-tokens/semantic/color/${name}.json`, source);
  colorThemes.push({ id: `figma-main-${name}`, name, group: 'Color', selectedTokenSets: { [`semantic/color/${name}`]: 'enabled' }, $figmaCollectionId: collections.Color.id, $figmaModeId: mode.modeId });
}
const paletteNames = Object.keys(semantic.color).filter(name => semantic.color[name]['base-default']);
write('design-tokens/semantic/style.json', semantic);
for (const name of paletteNames.filter(name => !colorThemes.some(t => t.name === name))) {
  const source = Object.fromEntries(Object.keys(semantic.color[name]).filter(role => members('Color').some(v => v.name === role)).map(role => [role, { $type: 'color', $value: `{color.${name}.${role}}` }]));
  write(`design-tokens/semantic/color/${name}.json`, source);
  colorThemes.push({ id: `palette-${name}`, name, group: 'Color', selectedTokenSets: { [`semantic/color/${name}`]: 'enabled' } });
}
write('design-tokens/$themes.json', [...themes, ...colorThemes]);
const metadata = read('design-tokens/$metadata.json');
metadata.tokenSetOrder = metadata.tokenSetOrder.filter(s => !s.startsWith('semantic/color/') && s !== 'semantic/style');
for (const theme of ['theme', 'konferansesenter']) {
  const set = `primitives/modes/typography/header/${theme}`;
  if (!metadata.tokenSetOrder.includes(set)) metadata.tokenSetOrder.push(set);
}
metadata.tokenSetOrder.push(...colorThemes.map(t => `semantic/color/${t.name}`), 'semantic/style');
write('design-tokens/$metadata.json', metadata);
const config = read('designsystemet.config.json');
for (const [theme, settings] of Object.entries(config.themes)) {
  const modes = { Theme: theme, 'Color scheme': 'Light' };
  settings.colors = Object.fromEntries(paletteNames.filter(n => !['info','success','warning','danger'].includes(n) && !n.startsWith('hoved-')).map(name => {
    const v = members('Semantic').find(v => v.name === `color/${name}/base-default`) ?? members('Semantic').find(v => v.name === `color/${name === 'primary-color-red' ? 'red-cta' : 'rust-main'}/base-default`);
    return [name, resolve(v, modes)];
  }));
  settings.overrides.colors = {};
  for (const v of members('Semantic').filter(v => v.type === 'COLOR')) {
    const [,palette,role] = v.name.split('/');
    if (!paletteNames.includes(palette) || !members('Color').some(v => v.name === role)) continue;
    (settings.overrides.colors[palette] ??= {})[role] = Object.fromEntries(['Light','Dark'].map(scheme => [scheme.toLowerCase(), resolve(v, { Theme: theme, 'Color scheme': scheme })]));
  }
  for (const [oldName,newName] of Object.entries({ 'primary-color-red':'red-cta', 'secondary-color-rust':'rust-main' })) settings.overrides.colors[oldName] = settings.overrides.colors[newName];
}
write('designsystemet.config.json', config);
console.log(`Imported ${main.variables.length} Main variables; ${colorThemes.length} public color selectors. Run npm run build.`);
