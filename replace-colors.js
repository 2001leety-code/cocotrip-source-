const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let newCode = code;

  // Gradients
  newCode = newCode.replace(/from-\[#E84B8A\] to-\[#C62368\]/g, 'from-[#7C5CFC] to-[#EA537E]');
  newCode = newCode.replace(/from="#E84B8A" to="#C62368"/g, 'from="#7C5CFC" to="#EA537E"');
  newCode = newCode.replace(/linear-gradient\(135deg, #E84B8A, #C62368\)/g, 'linear-gradient(135deg, #7C5CFC, #EA537E)');
  newCode = newCode.replace(/linear-gradient\(90deg, #E84B8A, #C62368\)/g, 'linear-gradient(90deg, #7C5CFC, #EA537E)');
  newCode = newCode.replace(/linear-gradient\(to right, #E84B8A, #C62368\)/g, 'linear-gradient(to right, #7C5CFC, #EA537E)');
  newCode = newCode.replace(/bg-gradient-to-tr from-\[#E84B8A\] to-\[#C62368\]/g, 'bg-gradient-to-tr from-[#7C5CFC] to-[#EA537E]');
  newCode = newCode.replace(/bg-gradient-to-r from-\[#E84B8A\] to-\[#C62368\]/g, 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E]');

  // RGBA matches for E84B8A -> 124,92,252 (7C5CFC)
  newCode = newCode.replace(/rgba\(232,75,138/g, 'rgba(124,92,252');

  // Exact HEX matches
  newCode = newCode.replace(/#E84B8A/g, '#7C5CFC');
  newCode = newCode.replace(/#C62368/g, '#EA537E');

  if (code !== newCode) {
    fs.writeFileSync(filePath, newCode, 'utf8');
    console.log('Updated:', filePath);
  }
}

function walkUrl(dir) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDir = fs.statSync(dirPath).isDirectory();
    if (isDir) {
      walkUrl(dirPath);
    } else {
      if (f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css') || f.endsWith('.js') || f.endsWith('.jsx')) {
        replaceInFile(dirPath);
      }
    }
  });
}

walkUrl(path.join(__dirname, 'src'));
walkUrl(path.join(__dirname, 'netlify'));
