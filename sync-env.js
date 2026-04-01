const { execSync } = require('child_process');
const fs = require('fs');

try {
  const jsonStr = execSync('npx netlify env:list --json', { encoding: 'utf8' });
  
  // Extract json object if there is some surrounding text
  const match = jsonStr.match(/\{[\s\S]*\}$/);
  if (!match) throw new Error("No JSON found");
  
  const json = JSON.parse(match[0]);
  let envContent = '';
  for (const [k, v] of Object.entries(json)) {
    if (v.includes('\n') || v.includes('\\n')) {
       // quote lines with newlines
       envContent += `${k}="${v.replace(/\n/g, '\\n')}"\n`;
    } else {
       envContent += `${k}=${v}\n`;
    }
  }
  fs.writeFileSync('.env', envContent, 'utf8');
  console.log('Saved .env file successfully from Netlify!');
} catch (err) {
  console.error(err);
}
