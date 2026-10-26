'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { generateSite } = require('../scripts/generate-site');

async function fingerprintTree(root) {
    const files = [];
    async function visit(directory) {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(absolutePath);
            else if (entry.isFile()) {
                const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
                const content = await fs.readFile(absolutePath);
                files.push(`${relativePath}:${crypto.createHash('sha256').update(content).digest('hex')}`);
            }
        }
    }
    await visit(root);
    return files;
}

test('production generation is deterministic and replaces a prior output tree', async t => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jaze-generator-'));
    const distRoot = path.join(temporaryRoot, 'dist');
    t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

    const first = await generateSite({ distRoot });
    const firstFingerprint = await fingerprintTree(distRoot);
    await fs.writeFile(path.join(distRoot, 'stale-file.txt'), 'must be removed');
    const second = await generateSite({ distRoot });
    const secondFingerprint = await fingerprintTree(distRoot);

    assert.deepEqual(secondFingerprint, firstFingerprint);
    assert.ok(first.htmlCount >= 29);
    assert.equal(second.htmlCount, first.htmlCount);
    await assert.rejects(fs.access(path.join(distRoot, 'stale-file.txt')));
});
