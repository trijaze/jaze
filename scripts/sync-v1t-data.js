'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {
    buildMemberLookup,
    filterCvesByFinder,
    indexLocalRecords,
    validateCveFinders,
    writeJsonFilesAtomically
} = require('./cve-data');

const projectRoot = path.resolve(__dirname, '..');
const defaultSourceRoot = path.resolve(projectRoot, '..', 'v1t');
const targetDataRoot = path.join(projectRoot, 'assets', 'data');
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/xuanlockun/v1t/refs/heads/main';
const DATA_FILES = Object.freeze(['members.json', 'cves-list.json', 'cves-local.json']);
const STATIC_ASSETS = Object.freeze([
    { source: ['assets', 'images', 'jaze_v1t.png'], target: ['assets', 'images', 'jaze_v1t.png'] },
    { source: ['favicon.ico'], target: ['favicon.ico'] }
]);

function parseArgs(argv) {
    let sourceRoot = process.env.V1T_SOURCE_DIR
        ? path.resolve(process.env.V1T_SOURCE_DIR)
        : defaultSourceRoot;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--source') {
            const value = argv[index + 1];
            if (!value) throw new Error('--source requires a directory path.');
            sourceRoot = path.resolve(value);
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    return { sourceRoot };
}

async function fetchRemoteJson(fileName) {
    const url = `${GITHUB_RAW_BASE}/assets/data/${fileName}`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Jaze-Security-Research-Automation/1.0'
        },
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching remote ${url}`);
    }
    const text = await response.text();
    try {
        return { fileName, filePath: url, text, value: JSON.parse(text), isRemote: true };
    } catch (e) {
        throw new Error(`Invalid JSON from remote ${url}: ${e.message}`);
    }
}

async function fetchRemoteStaticAsset(asset) {
    const url = `${GITHUB_RAW_BASE}/${asset.source.join('/')}`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Jaze-Security-Research-Automation/1.0' },
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching remote ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    return { ...asset, filePath: url, content, isRemote: true };
}

async function readJsonSource(sourceRoot, fileName) {
    const filePath = path.join(sourceRoot, 'assets', 'data', fileName);
    if (!fsSync.existsSync(filePath)) {
        console.log(`[sync-v1t] Local file not found at ${filePath}. Falling back to GitHub raw upstream...`);
        return await fetchRemoteJson(fileName);
    }

    let text;
    try {
        text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read ${filePath}: ${error.message}`);
    }

    try {
        return { fileName, filePath, text, value: JSON.parse(text), isRemote: false };
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
}

async function readStaticAssetSource(sourceRoot, asset) {
    const filePath = path.join(sourceRoot, ...asset.source);
    if (!fsSync.existsSync(filePath)) {
        try {
            return await fetchRemoteStaticAsset(asset);
        } catch (e) {
            console.warn(`[sync-v1t] Remote asset fetch notice: ${e.message}`);
            return null;
        }
    }

    let content;
    try {
        content = await fs.readFile(filePath);
    } catch (error) {
        throw new Error(`Unable to read ${filePath}: ${error.message}`);
    }
    if (!content.length) {
        throw new Error(`Static asset is empty: ${filePath}`);
    }
    return { ...asset, filePath, content, isRemote: false };
}

async function writeBinaryFileAtomically(targetPath, content) {
    const resolvedTarget = path.resolve(targetPath);
    const transactionId = `${process.pid}-${Date.now()}`;
    const temporaryPath = `${resolvedTarget}.${transactionId}.tmp`;
    const backupPath = `${resolvedTarget}.${transactionId}.bak`;
    let hadOriginal = false;
    let installed = false;

    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    try {
        await fs.writeFile(temporaryPath, content, { flag: 'wx' });
        try {
            await fs.rename(resolvedTarget, backupPath);
            hadOriginal = true;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await fs.rename(temporaryPath, resolvedTarget);
        installed = true;
        if (hadOriginal) await fs.rm(backupPath, { force: true });
    } catch (error) {
        if (installed) await fs.rm(resolvedTarget, { force: true }).catch(() => {});
        if (hadOriginal) await fs.rename(backupPath, resolvedTarget).catch(() => {});
        throw error;
    } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
}

function validateSourceData(sources) {
    const members = sources['members.json'].value;
    const rawCveList = sources['cves-list.json'].value;
    const localRecords = sources['cves-local.json'].value;

    const normalizedItems = validateCveFinders(rawCveList, members);
    const memberLookup = buildMemberLookup(members);
    const localRecordsById = indexLocalRecords(localRecords);
    const jazeItems = filterCvesByFinder(normalizedItems, 'jaze');

    if (!memberLookup.has('jaze')) {
        throw new Error('members.json does not declare Jaze as a member or alias.');
    }
    if (jazeItems.length === 0) {
        throw new Error('cves-list.json does not contain any CVE assigned to Jaze.');
    }

    return {
        inputGroupCount: rawCveList.length,
        cveCount: normalizedItems.length,
        jazeCveCount: jazeItems.length,
        memberCount: members.length,
        localRecordCount: localRecordsById.size,
        missingLocalIds: normalizedItems
            .map(item => item.id)
            .filter(id => !localRecordsById.has(id))
    };
}

async function syncV1tData(options = {}) {
    const sourceRoot = path.resolve(options.sourceRoot || defaultSourceRoot);
    const targetRoot = path.resolve(options.targetRoot || targetDataRoot);
    const sourceEntries = await Promise.all(DATA_FILES.map(
        fileName => readJsonSource(sourceRoot, fileName)
    ));
    const assetEntries = await Promise.all(STATIC_ASSETS.map(
        asset => readStaticAssetSource(sourceRoot, asset)
    ));
    const sources = Object.fromEntries(sourceEntries.map(entry => [entry.fileName, entry]));

    // Validate the complete snapshot before touching any target file.
    const summary = validateSourceData(sources);
    const changedFiles = [];

    for (const fileName of DATA_FILES) {
        const targetPath = path.join(targetRoot, fileName);
        let currentText = null;
        try {
            currentText = await fs.readFile(targetPath, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`Unable to inspect ${targetPath}: ${error.message}`);
            }
        }
        if (currentText !== sources[fileName].text) {
            changedFiles.push({ path: targetPath, text: sources[fileName].text, fileName });
        }
    }

    if (changedFiles.length) {
        await writeJsonFilesAtomically(changedFiles);
    }

    const changedAssets = [];
    for (const asset of assetEntries.filter(Boolean)) {
        const targetPath = path.join(projectRoot, ...asset.target);
        let current = null;
        try {
            current = await fs.readFile(targetPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`Unable to inspect ${targetPath}: ${error.message}`);
            }
        }
        if (!current || !current.equals(asset.content)) {
            await writeBinaryFileAtomically(targetPath, asset.content);
            changedAssets.push(asset.target.join('/'));
        }
    }

    return {
        ...summary,
        sourceRoot,
        targetRoot,
        changedFiles: changedFiles.map(file => file.fileName),
        changedAssets
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    console.log(`Validating V1T data snapshot from ${options.sourceRoot}`);
    const summary = await syncV1tData(options);
    console.log(
        `Validated ${summary.inputGroupCount} group(s) -> ${summary.cveCount} CVE(s), `
        + `${summary.jazeCveCount} assigned to Jaze.`
    );
    console.log(
        `Validated ${summary.memberCount} member(s) and ${summary.localRecordCount} local record(s).`
    );
    if (summary.missingLocalIds.length) {
        console.warn(`Local cache is missing: ${summary.missingLocalIds.join(', ')}`);
    }
    console.log(summary.changedFiles.length
        ? `Synced: ${summary.changedFiles.join(', ')}`
        : 'Jaze data is already in sync with V1T.');
    console.log(summary.changedAssets.length
        ? `Synced assets: ${summary.changedAssets.join(', ')}`
        : 'Jaze static assets are already in sync with V1T.');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`V1T data sync failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({
    DATA_FILES,
    STATIC_ASSETS,
    defaultSourceRoot,
    parseArgs,
    readJsonSource,
    syncV1tData,
    validateSourceData
});
