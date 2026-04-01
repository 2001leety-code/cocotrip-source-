import fs from 'fs';
import path from 'path';

function fixFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace imports
  content = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, p1) => {
    if (!p1.endsWith('.js') && !p1.endsWith('.ts')) {
      return `from "${p1}.js"`;
    }
    return match;
  });

  // Fix properties
  if (filePath.endsWith('RouteAgent.ts') || filePath.endsWith('QAAgent.ts') || filePath.endsWith('SimpleAgents.ts')) {
    content = content.replace(/agentName: this\.agentKey/g, 'agentName: (this as any).agentKey');
    content = content.replace(/systemPrompt: this\.systemPrompt/g, 'systemPrompt: (this as any).systemPrompt');
  }

  fs.writeFileSync(filePath, content);
  console.log('Fixed', filePath);
}

const baseDir = path.join(process.cwd(), 'netlify/functions/ai_core');
const filesToFix = [
  'orchestrator.ts',
  'config.ts',
  'agents/BaseAgent.ts',
  'agents/RouteAgent.ts',
  'agents/QAAgent.ts',
  'agents/SimpleAgents.ts'
];

filesToFix.forEach(f => fixFile(path.join(baseDir, f)));
