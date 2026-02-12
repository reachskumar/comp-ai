/* eslint-disable */
/**
 * fix-esm-imports.cjs
 * Adds .js extensions to relative imports in compiled ESM output.
 * Needed because Prisma 7's generated TypeScript uses extensionless imports
 * which fail under Node.js ESM resolution.
 */
const fs = require('fs');
const path = require('path');

function fixImportsInDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixImportsInDir(fullPath);
    } else if (entry.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const updated = content.replace(
        /from\s+["'](\.\.?\/[^"']+?)["']/g,
        (match, importPath) => {
          if (importPath.endsWith('.js') || importPath.endsWith('.json') || importPath.endsWith('.mjs') || importPath.endsWith('.cjs')) {
            return match;
          }
          return match.replace(importPath, importPath + '.js');
        }
      );
      if (updated !== content) {
        fs.writeFileSync(fullPath, updated);
        console.log('Fixed ESM imports in:', path.relative(process.cwd(), fullPath));
      }
    }
  }
}

const distGenerated = path.join(__dirname, 'dist', 'generated');
fixImportsInDir(distGenerated);

