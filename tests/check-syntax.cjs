const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let checked = 0;
function check(source, label, module) {
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + (module ? 'module' : 'commonjs')], { input: source, encoding: 'utf8' });
  if (result.status !== 0) { console.error(label + '\n' + (result.stderr || result.error)); process.exitCode = 1; }
  checked++;
}
for (const file of fs.readdirSync(root)) {
  const sourcePath = path.join(root, file);
  if (file.endsWith('.js')) check(fs.readFileSync(sourcePath, 'utf8'), file, true);
  if (file.endsWith('.html')) {
    const html = fs.readFileSync(sourcePath, 'utf8');
    let index = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      index++;
      if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
      const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
      if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
      check(match[2], file + ' script ' + index, type === 'module');
    }
  }
}
if (!process.exitCode) console.log('PASS: ' + checked + ' JavaScript files and inline scripts parse successfully.');
