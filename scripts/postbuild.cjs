/*
 * Ensures the compiled CLI entry has a shebang so it can be executed as an npm "bin".
 */

const fs = require('fs');
const path = require('path');

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

if (!fs.existsSync(cliPath)) {
  process.exit(0);
}

let content = fs.readFileSync(cliPath, 'utf8');
if (!content.startsWith('#!/usr/bin/env node')) {
  content = `#!/usr/bin/env node\n${content}`;
  fs.writeFileSync(cliPath, content, 'utf8');
}

try {
  fs.chmodSync(cliPath, 0o755);
} catch {
  // ignore on platforms where chmod isn't meaningful
}
