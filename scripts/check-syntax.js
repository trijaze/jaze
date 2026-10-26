'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'note-jaze']);

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJavaScriptFiles(absolutePath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(absolutePath);
        }
    }
    return files;
}

const files = collectJavaScriptFiles(projectRoot).sort();
if (!files.length) {
    console.log('No JavaScript files found.');
    process.exit(0);
}

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
        process.exit(result.status || 1);
    }
}

console.log(`Syntax check passed for ${files.length} JavaScript file(s).`);
