'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isOfficialCveId } = require('../assets/js/cve-list-contract');
const {
    filterCvesByFinder,
    hasUsableRecordData,
    indexLocalRecords,
    writeJsonFilesAtomically
} = require('./cve-data');

const projectRoot = path.resolve(__dirname, '..');
const listPath = path.join(projectRoot, 'assets', 'data', 'cves-list.json');
const outPath = path.join(projectRoot, 'assets', 'data', 'cves-local.json');
const FETCH_TIMEOUT_MS = 20000;
const FETCH_DELAY_MS = 220;

async function readJson(filePath, label) {
    let text;
    try {
        text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read ${label}: ${error.message}`);
    }

    try {
        return { text, value: JSON.parse(text) };
    } catch (error) {
        throw new Error(`Invalid ${label}: ${error.message}`);
    }
}

async function fetchMitreRecord(id, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('This script requires Node.js 20+ with global fetch support.');
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(
            `https://cveawg.mitre.org/api/cve/${encodeURIComponent(id)}`,
            {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'Jaze-Security-Research-Automation/1.0'
                },
                cache: 'no-store',
                signal: controller.signal
            }
        );
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status} ${response.statusText}`);
            error.status = response.status;
            throw error;
        }

        const record = await response.json();
        const returnedId = record?.cveMetadata?.cveId
            ? String(record.cveMetadata.cveId).trim().toUpperCase()
            : '';
        if (returnedId !== id) {
            throw new Error(`MITRE response id mismatch for ${id}: ${returnedId || 'missing id'}`);
        }
        return record;
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
            timeoutError.name = 'TimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function createReservedRecord(id) {
    return {
        dataType: 'CVE_RECORD',
        dataVersion: '5.1',
        cveMetadata: { cveId: id, state: 'RESERVED' },
        containers: {}
    };
}

function createCustomRecord(id) {
    return {
        dataType: 'CVE_RECORD',
        dataVersion: '5.1',
        cveMetadata: { cveId: id, state: 'CUSTOM_POC' },
        containers: {
            cna: {
                title: `${id} Research Advisory`,
                descriptions: [{
                    lang: 'en',
                    value: 'Jaze security research internal vulnerability record.'
                }]
            }
        }
    };
}

async function updateCves(options = {}) {
    const finder = options.finder || 'jaze';
    const sourceListPath = path.resolve(options.listPath || listPath);
    const cachePath = path.resolve(options.outPath || outPath);
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : FETCH_DELAY_MS;
    const [listData, cacheData] = await Promise.all([
        readJson(sourceListPath, 'cves-list.json'),
        readJson(cachePath, 'cves-local.json')
    ]);

    const targetItems = filterCvesByFinder(listData.value, finder);
    const localRecordsById = indexLocalRecords(cacheData.value);
    let fetchedCount = 0;
    let cachedCount = 0;
    let reservedCount = 0;
    let customCount = 0;
    let failedCount = 0;

    for (const item of targetItems) {
        const existing = localRecordsById.get(item.id);
        if (hasUsableRecordData(existing)) {
            cachedCount += 1;
            continue;
        }
        if (!isOfficialCveId(item.id)) {
            if (!existing) localRecordsById.set(item.id, createCustomRecord(item.id));
            customCount += 1;
            continue;
        }

        try {
            const record = await fetchMitreRecord(item.id, options);
            localRecordsById.set(item.id, record);
            fetchedCount += 1;
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        } catch (error) {
            if (error.status === 404) {
                if (!existing) localRecordsById.set(item.id, createReservedRecord(item.id));
                reservedCount += 1;
            } else {
                failedCount += 1;
                console.warn(`Unable to update ${item.id}: ${error.message}`);
            }
        }
    }

    const outputText = `${JSON.stringify([...localRecordsById.values()], null, 2)}\n`;
    const changed = outputText !== cacheData.text;
    if (changed) {
        await writeJsonFilesAtomically([{ path: cachePath, text: outputText }]);
    }

    return {
        finder,
        targetCount: targetItems.length,
        cachedCount,
        fetchedCount,
        reservedCount,
        customCount,
        failedCount,
        changed
    };
}

async function main() {
    console.log(`Updating Jaze CVE cache from ${listPath}`);
    const summary = await updateCves();
    console.log(
        `${summary.targetCount} target(s): ${summary.cachedCount} cached, `
        + `${summary.fetchedCount} fetched, ${summary.reservedCount} reserved, `
        + `${summary.customCount} custom, ${summary.failedCount} failed.`
    );
    console.log(summary.changed ? `Updated ${outPath}` : 'No cache changes were required.');
    if (summary.failedCount) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`CVE update failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({
    FETCH_DELAY_MS,
    FETCH_TIMEOUT_MS,
    createCustomRecord,
    createReservedRecord,
    fetchMitreRecord,
    updateCves
});
