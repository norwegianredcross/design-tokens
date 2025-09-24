// build-metadata.js
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const set = require('lodash.set');

/**
 * Parses CSS to extract variables and build a nested JavaScript object.
 * @returns {object} The structured metadata object.
 */
async function buildMetadata() {
  const sourceCssPath = path.join('design-tokens-build', 'theme.css');
  const outputJsonPath = path.join('design-tokens-build', 'metadata.json');
  const packageJsonPath = path.join(__dirname, 'package.json');

  if (!fs.existsSync(sourceCssPath)) {
    console.error(`❌ Error: Source CSS file not found at ${sourceCssPath}. Run the token build first.`);
    process.exit(1);
  }

  console.log('🚀 Starting metadata generation from CSS tokens...');
  const css = fs.readFileSync(sourceCssPath, 'utf8');
  const root = postcss.parse(css);
  const metadata = {};

  // Extract package version
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageVersion = packageJson.version || 'unknown';

  root.walkRules(rule => {
    // Determine the category (light, dark, semantic, etc.) from the layer name in the selector
    const layerMatch = rule.selector.match(/@layer\s+ds\.theme\.([^;]+)/);
    let categoryPath = [];

    if (rule.selector.includes('[data-color-scheme="light"]')) {
        categoryPath = ['tokens', 'light'];
    } else if (rule.selector.includes('[data-color-scheme="dark"]')) {
        categoryPath = ['tokens', 'dark'];
    } else if (rule.selector.includes('[data-typography="primary"]')) {
        categoryPath = ['tokens', 'typography', 'primary'];
    } else if (rule.selector.includes('[data-typography="secondary"]')) {
        categoryPath = ['tokens', 'typography', 'secondary'];
    } else if (rule.selector.includes(':root')) {
       // This could be semantic or a base light theme. We check for known semantic variables.
       let isSemantic = false;
       rule.walkDecls(decl => {
           if (decl.prop.startsWith('--ds-size-') || decl.prop.startsWith('--ds-border-') || decl.prop.startsWith('--ds-shadow-')) {
               isSemantic = true;
           }
       });
       if (isSemantic) {
          categoryPath = ['tokens', 'semantic'];
       }
    }

    if (categoryPath.length > 0) {
      rule.walkDecls(decl => {
        if (decl.prop.startsWith('--ds-')) {
          // Create a nested path from the variable name
          // e.g., --ds-color-primary-base-default -> ['color', 'primary', 'base', 'default']
          const tokenPath = decl.prop.replace('--ds-', '').split('-');
          const fullPath = [...categoryPath, ...tokenPath];
          
          // Use lodash.set to create the nested object structure
          set(metadata, fullPath, { value: decl.value });
        }
      });
    }
  });

  const finalOutput = {
    version: packageVersion,
    ...metadata
  }


  fs.writeFileSync(outputJsonPath, JSON.stringify(finalOutput, null, 2));
  console.log(`✅ Metadata successfully generated at ${outputJsonPath}`);
}

buildMetadata();

