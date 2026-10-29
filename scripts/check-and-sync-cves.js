'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { syncV1tData } = require('./sync-v1t-data');
const { updateCves } = require('./update-cves');
const { generateSite } = require('./generate-site');
const { filterCvesByFinder, hasUsableRecordData } = require('./cve-data');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_V1T_DIR = path.resolve(PROJECT_ROOT, '..', 'v1t');
const DEFAULT_V1T_LIST_PATH = path.resolve(DEFAULT_V1T_DIR, 'assets', 'data', 'cves-list.json');
const DEFAULT_V1T_LOCAL_PATH = path.resolve(DEFAULT_V1T_DIR, 'assets', 'data', 'cves-local.json');
const JAZE_CVES_PATH = path.resolve(PROJECT_ROOT, 'assets', 'data', 'cves-list.json');
const JAZE_LOCAL_PATH = path.resolve(PROJECT_ROOT, 'assets', 'data', 'cves-local.json');
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/xuanlockun/v1t/refs/heads/main';

async function fetchRemoteJson(fileName) {
    const url = `${GITHUB_RAW_BASE}/assets/data/${fileName}`;
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Jaze-CVE-Checker/1.0' },
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
    }
    return await response.json();
}

async function loadV1tData(v1tPath) {
    const isLocalDir = fs.existsSync(v1tPath) && fs.statSync(v1tPath).isDirectory();
    const localListFile = isLocalDir ? path.join(v1tPath, 'assets', 'data', 'cves-list.json') : v1tPath;
    const localLocalFile = isLocalDir ? path.join(v1tPath, 'assets', 'data', 'cves-local.json') : path.join(path.dirname(v1tPath), 'cves-local.json');

    if (fs.existsSync(localListFile) && fs.existsSync(localLocalFile)) {
        return {
            sourceType: 'local',
            sourceRoot: isLocalDir ? v1tPath : path.dirname(path.dirname(v1tPath)),
            cveList: JSON.parse(fs.readFileSync(localListFile, 'utf8')),
            cveLocal: JSON.parse(fs.readFileSync(localLocalFile, 'utf8'))
        };
    }

    console.log('[CVE Checker] Local V1T files not found. Connecting to remote GitHub raw repository...');
    try {
        const [cveList, cveLocal] = await Promise.all([
            fetchRemoteJson('cves-list.json'),
            fetchRemoteJson('cves-local.json')
        ]);
        return {
            sourceType: 'remote',
            sourceRoot: DEFAULT_V1T_DIR,
            cveList,
            cveLocal
        };
    } catch (err) {
        throw new Error(`Unable to load V1T source data (local or remote): ${err.message}`);
    }
}

async function checkAndSyncCves(options = {}) {
    const v1tPath = options.v1tPath || process.env.V1T_SOURCE_DIR || process.env.V1T_CVES_PATH || DEFAULT_V1T_DIR;
    const isPrePush = Boolean(options.prePush || process.argv.includes('--pre-push'));

    console.log(`[CVE Checker] Evaluating upstream V1T data...`);
    let v1tData;
    try {
        v1tData = await loadV1tData(v1tPath);
    } catch (err) {
        console.warn(`[CVE Checker] ${err.message}. Skipping upstream sync.`);
        return { skipped: true, reason: err.message };
    }

    const jazeList = JSON.parse(fs.readFileSync(JAZE_CVES_PATH, 'utf8'));
    const jazeLocal = JSON.parse(fs.readFileSync(JAZE_LOCAL_PATH, 'utf8'));

    const v1tJazeItems = filterCvesByFinder(v1tData.cveList, 'jaze');
    const jazeItems = filterCvesByFinder(jazeList, 'jaze');

    const jazeIdSet = new Set(jazeItems.map(it => it.id));
    const newCveIds = v1tJazeItems.map(it => it.id).filter(id => !jazeIdSet.has(id));

    // Check for status changes (e.g. RESERVED -> PUBLISHED)
    const jazeLocalMap = new Map();
    jazeLocal.forEach(rec => {
        const id = rec?.cveMetadata?.cveId || rec?.cveId;
        if (id) jazeLocalMap.set(id, rec);
    });

    const statusUpdates = [];
    v1tData.cveLocal.forEach(v1tRec => {
        const id = v1tRec?.cveMetadata?.cveId || v1tRec?.cveId;
        if (!id || !jazeIdSet.has(id)) return;
        const jazeRec = jazeLocalMap.get(id);
        const v1tState = v1tRec?.cveMetadata?.state || '';
        const jazeState = jazeRec?.cveMetadata?.state || '';

        // If upstream published or has usable CNA record while local was reserved/empty
        if (v1tState === 'PUBLISHED' && jazeState !== 'PUBLISHED') {
            statusUpdates.push({ id, from: jazeState, to: v1tState });
        } else if (hasUsableRecordData(v1tRec) && !hasUsableRecordData(jazeRec)) {
            statusUpdates.push({ id, from: 'placeholder', to: 'cna-advisory' });
        }
    });

    console.log(`[CVE Checker] Upstream Jaze CVEs: ${v1tJazeItems.length} | Local Jaze CVEs: ${jazeItems.length}`);
    if (newCveIds.length > 0) {
        console.log(`[CVE Checker] 🚀 New CVE ID(s) detected: ${newCveIds.join(', ')}`);
    }
    if (statusUpdates.length > 0) {
        console.log(`[CVE Checker] 📢 State/Advisory update(s) detected: ${statusUpdates.map(u => `${u.id} (${u.from} -> ${u.to})`).join(', ')}`);
    }

    let changed = false;
    // Step 1: Run atomic V1T sync if new CVEs, status updates, or file differences detected
    if (newCveIds.length > 0 || statusUpdates.length > 0 || v1tData.cveLocal.length !== jazeLocal.length) {
        console.log('[CVE Checker] 📥 Syncing data files from upstream V1T...');
        const syncSummary = await syncV1tData({ sourceRoot: v1tData.sourceRoot });
        if (syncSummary.changedFiles && syncSummary.changedFiles.length > 0) {
            changed = true;
            console.log(`[CVE Checker] 📄 Synced files: ${syncSummary.changedFiles.join(', ')}`);
        }
    }

    // Step 2: Poll MITRE for any currently RESERVED CVEs that may have been published on MITRE
    console.log('[CVE Checker] 🔍 Live-checking MITRE for reserved CVE updates...');
    try {
        const mitreSummary = await updateCves({ finder: 'jaze' });
        if (mitreSummary.changed) {
            changed = true;
            console.log(`[CVE Checker] ⚡ MITRE live check updated local cache.`);
        }
    } catch (mitreErr) {
        console.warn(`[CVE Checker] MITRE live check notice: ${mitreErr.message}`);
    }

    // Step 3: If any files changed, rebuild site immediately
    if (changed) {
        console.log('[CVE Checker] 🔨 Rebuilding Jaze site with fresh CVE records...');
        const buildSummary = await generateSite();
        console.log(`[CVE Checker] 🌐 Generated ${buildSummary.fileCount} files (${buildSummary.htmlCount} HTML pages) successfully.`);
    } else {
        console.log(`[CVE Checker] ✨ Local Jaze CVE archive is 100% up to date (${jazeItems.length} CVEs).`);
    }

    // Step 4: If running before git push and files changed, auto-commit
    if (isPrePush && changed && !process.env.AUTO_SYNCING_PUSH) {
        try {
            const gitStatus = execSync('git status --porcelain assets/data dist index.html', {
                cwd: PROJECT_ROOT,
                encoding: 'utf8'
            }).trim();

            if (gitStatus) {
                console.log('[CVE Checker] 📦 Staging updated CVE data and build artifacts...');
                execSync('git add assets/data dist index.html', { cwd: PROJECT_ROOT });
                const commitMsg = `chore(cve): auto-sync ${newCveIds.length ? `${newCveIds.length} new CVE(s)` : 'published advisories'} from upstream`;
                execSync(`git commit -m "${commitMsg}"`, { cwd: PROJECT_ROOT });
                const commitHash = execSync('git rev-parse --short HEAD', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8'
                }).trim();
                console.log(`[CVE Checker] 📝 Created commit: ${commitHash} - ${commitMsg}`);

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

    return { inSync: !changed, count: jazeItems.length, newCount: newCveIds.length, changed };
}

if (require.main === module) {
    checkAndSyncCves().catch(error => {
        console.error('[CVE Checker] Error:', error);
        process.exit(1);
    });
}

module.exports = {
    checkAndSyncCves,
    DEFAULT_V1T_DIR
};

