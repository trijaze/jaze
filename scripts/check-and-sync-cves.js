'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { syncV1tData } = require('./sync-v1t-data');
const { generateSite } = require('./generate-site');
const { filterCvesByFinder } = require('./cve-data');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_V1T_PATH = path.resolve(PROJECT_ROOT, '..', 'v1t', 'assets', 'data', 'cves-list.json');
const JAZE_CVES_PATH = path.resolve(PROJECT_ROOT, 'assets', 'data', 'cves-list.json');

function getJazeCveMap(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const jazeItems = filterCvesByFinder(rawData, 'jaze');
    const idMap = new Map();
    for (const item of jazeItems) {
        idMap.set(item.id, item);
    }
    return { rawData, jazeItems, idMap };
}

async function checkAndSyncCves(options = {}) {
    const v1tPath = options.v1tPath || process.env.V1T_CVES_PATH || DEFAULT_V1T_PATH;
    const isPrePush = Boolean(options.prePush || process.argv.includes('--pre-push'));

    console.log(`[CVE Checker] Checking V1T CVE list at: ${v1tPath}`);

    if (!fs.existsSync(v1tPath)) {
        console.warn(`[CVE Checker] Warning: V1T file not found at ${v1tPath}. Skipping sync.`);
        return { skipped: true, reason: 'v1t_not_found' };
    }

    const v1t = getJazeCveMap(v1tPath);
    const jaze = getJazeCveMap(JAZE_CVES_PATH);

    const newCveIds = [];
    for (const id of v1t.idMap.keys()) {
        if (!jaze.idMap.has(id)) {
            newCveIds.push(id);
        }
    }

    console.log(`[CVE Checker] V1T Jaze CVEs: ${v1t.idMap.size} | Local Jaze CVEs: ${jaze.idMap.size}`);

    if (newCveIds.length === 0 && v1t.idMap.size <= jaze.idMap.size) {
        console.log(`[CVE Checker] ✨ Local Jaze CVE archive is already up to date (${jaze.idMap.size} CVEs).`);
        return { inSync: true, count: jaze.idMap.size, newCount: 0 };
    }

    console.log(`[CVE Checker] 🚀 Found ${newCveIds.length || (v1t.idMap.size - jaze.idMap.size)} new CVE(s) with tag 'jaze' in V1T:`);
    if (newCveIds.length > 0) {
        newCveIds.forEach(id => console.log(`   + ${id}`));
    }

    // Step 1: Run atomic V1T sync
    console.log('[CVE Checker] 📥 Syncing data files from V1T...');
    const syncSummary = await syncV1tData({
        sourceRoot: path.dirname(path.dirname(v1tPath))
    });
    console.log(`[CVE Checker] 📄 Synced files: ${syncSummary.changedFiles.join(', ') || 'none'}`);

    // Step 2: Regenerate static site so all HTML, dist, and sitemap are up to date
    console.log('[CVE Checker] 🔨 Rebuilding Jaze site...');
    const buildSummary = await generateSite();
    console.log(`[CVE Checker] 🌐 Generated ${buildSummary.fileCount} files (${buildSummary.htmlCount} HTML pages) successfully.`);

    // Step 3: If running before git push, auto-commit new files
    if (isPrePush && !process.env.AUTO_SYNCING_PUSH) {
        try {
            const gitStatus = execSync('git status --porcelain assets/data dist index.html', {
                cwd: PROJECT_ROOT,
                encoding: 'utf8'
            }).trim();

            if (gitStatus) {
                console.log('[CVE Checker] 📦 Staging updated CVE data and build artifacts...');
                execSync('git add assets/data dist index.html', { cwd: PROJECT_ROOT });
                const commitMsg = `chore(cve): auto-sync ${newCveIds.length || 'new'} CVE(s) from V1T`;
                execSync(`git commit -m "${commitMsg}"`, { cwd: PROJECT_ROOT });
                const commitHash = execSync('git rev-parse --short HEAD', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8'
                }).trim();
                console.log(`[CVE Checker] 📝 Created commit: ${commitHash} - ${commitMsg}`);

                // Inform pre-push hook to push the new commit
                console.log('[CVE Checker] 🔄 Pushing updated commit...');
                execSync('git push origin HEAD --no-verify', {
                    cwd: PROJECT_ROOT,
                    env: { ...process.env, AUTO_SYNCING_PUSH: '1' },
                    stdio: 'inherit'
                });
            }
        } catch (gitErr) {
            console.warn(`[CVE Checker] Git auto-commit notice: ${gitErr.message}`);
        }
    }

    console.log('[CVE Checker] ✅ Auto-sync complete. Archive is fully updated.');
    return { inSync: false, count: v1t.idMap.size, newCount: newCveIds.length };
}

if (require.main === module) {
    checkAndSyncCves().catch(error => {
        console.error('[CVE Checker] Error:', error);
        process.exit(1);
    });
}

module.exports = {
    checkAndSyncCves,
    DEFAULT_V1T_PATH
};

