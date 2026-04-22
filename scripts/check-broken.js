// Check for truly broken (JSON-serialized) files
const fs = require('fs');
const path = require('path');

function check(dir) {
  const broken = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const p = path.join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        broken.push(...check(p));
      } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js'))) {
        const c = fs.readFileSync(p, 'utf8').trim();
        // Skip normal "use client" / "use strict" directives
        if (c.startsWith('"use client"') || c.startsWith('"use strict"') || c.startsWith("'use client'") || c.startsWith("'use strict'")) continue;
        // Check for JSON-escaped content
        if (c.startsWith('"') && c.includes('\\n')) {
          broken.push(p.replace(process.cwd() + path.sep, ''));
        }
      }
    }
  } catch (e) { /* skip */ }
  return broken;
}

const r = [...check('src'), ...check('api'), ...check('tests')];
console.log('Truly broken files:', r.length);
r.forEach(f => console.log('  -', f));
