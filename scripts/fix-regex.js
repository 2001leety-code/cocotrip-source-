const fs = require('fs');
let c = fs.readFileSync('src/pages/PlanDetailPage.tsx', 'utf-8');

// Fix broken Korean regex (PowerShell corrupted the unicode chars)
c = c.replace(
  /const addrMatch = \(stop\.address \|\| ''\)\.match\([^)]*\);/g,
  "const addrMatch = (stop.address || '').match(/([\\uAC00-\\uD7A3]+\\uAD6C)/);"
);

fs.writeFileSync('src/pages/PlanDetailPage.tsx', c, 'utf-8');
console.log('Fixed Korean regex!');

// Verify
const fixed = fs.readFileSync('src/pages/PlanDetailPage.tsx', 'utf-8');
const lines = fixed.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('addrMatch')) {
    console.log(`Line ${i+1}: ${lines[i].trim()}`);
  }
}
