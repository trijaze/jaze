'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    filterCvesByFinder,
    joinCvesWithLocalRecords,
    validateCveFinders
} = require('../scripts/cve-data');
const { syncV1tData } = require('../scripts/sync-v1t-data');

const projectRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

test('filters Jaze membership independently of finder order and case', () => {
    const filtered = filterCvesByFinder([
        { id: 'CVE-2026-10001', finders: ['Jaze', 'Rawr'] },
        { id: 'CVE-2026-10002', finders: ['Rawr', 'Jaze'] },
        { id: 'CVE-2026-10003', finders: ['jaze'] },
        { id: 'CVE-2026-10004', finders: ['JAZE'] },
        { id: 'CVE-2026-10005', finders: ['Winky'] }
    ], 'jAzE');

    assert.deepEqual(filtered.map(item => item.id), [
        'CVE-2026-10001',
        'CVE-2026-10002',
        'CVE-2026-10003',
        'CVE-2026-10004'
    ]);
});

test('current V1T snapshot contains all 25 Jaze CVEs from both group orders', () => {
    const rawList = readJson('assets/data/cves-list.json');
    const filtered = filterCvesByFinder(rawList, 'jaze');
    const ids = new Set(filtered.map(item => item.id));

    assert.equal(filtered.length, 25);
    assert.equal(ids.has('CVE-2026-111830'), true, 'Jaze-first group must be included');
    assert.equal(ids.has('CVE-2026-111829'), true, 'Rawr-first group must be included');
});

test('validates finder names against member identities and aliases', () => {
    const members = [
        { id: 'jaze', name: 'Jaze', aliases: ['jz'] },
        { id: 'rawr', name: 'Rawr', aliases: [] }
    ];

    assert.equal(validateCveFinders([
        { id: 'CVE-2026-10001', finders: ['JZ', 'Rawr'] }
    ], members).length, 1);
    assert.throws(
        () => validateCveFinders([
            { id: 'CVE-2026-10002', finders: ['Unknown'] }
        ], members),
        /Unknown finder "Unknown"/
    );
});

test('joins only listed CVEs and creates inline placeholders for unpublished records', () => {
    const items = [
        { id: 'CVE-2026-10001', finders: ['Jaze'] },
        {
            id: 'CVE-2026-10002',
            finders: ['Jaze'],
            threat: 'high',
            target: 'Example Product',
            title: 'Pending advisory',
            cwe: 'cwe-79',
            description: 'Disclosure is pending.'
        }
    ];
    const publishedRecord = {
        cveMetadata: { cveId: 'CVE-2026-10001', state: 'PUBLISHED' },
        containers: { cna: { title: 'Published advisory' } }
    };
    const localRecords = [
        publishedRecord,
        {
            cveMetadata: { cveId: 'CVE-2026-10002', state: 'RESERVED' },
            containers: {}
        },
        {
            cveMetadata: { cveId: 'CVE-2026-99999', state: 'PUBLISHED' },
            containers: { cna: { title: 'Unlisted record' } }
        }
    ];

    const joined = joinCvesWithLocalRecords(items, localRecords);

    assert.equal(joined.length, 2);
    assert.equal(joined[0].record, publishedRecord);
    assert.equal(joined[0].isPlaceholder, false);
    assert.equal(joined[0].dataSource, 'local-cache');
    assert.equal(joined[1].state, 'RESERVED');
    assert.equal(joined[1].isPlaceholder, true);
    assert.equal(joined[1].dataSource, 'inline-placeholder');
    assert.equal(joined[1].record.containers.cna.title, 'Pending advisory');
    assert.equal(joined[1].record.containers.cna.affected[0].product, 'Example Product');
    assert.equal(joined[1].record.containers.cna.problemTypes[0].descriptions[0].cweId, 'CWE-79');
    assert.equal(joined[1].record.xJaze.threat, 'HIGH');
});

test('refuses an invalid V1T snapshot without overwriting existing target data', async t => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jaze-sync-test-'));
    const sourceRoot = path.join(temporaryRoot, 'v1t');
    const sourceDataRoot = path.join(sourceRoot, 'assets', 'data');
    const targetRoot = path.join(temporaryRoot, 'jaze-data');
    fs.mkdirSync(sourceDataRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

    const originals = {
        'members.json': '[{"id":"safe"}]\n',
        'cves-list.json': '["safe-list"]\n',
        'cves-local.json': '[{"id":"safe-cache"}]\n'
    };
    Object.entries(originals).forEach(([fileName, text]) => {
        fs.writeFileSync(path.join(targetRoot, fileName), text);
    });

    fs.writeFileSync(path.join(sourceDataRoot, 'members.json'), JSON.stringify([
        { id: 'jaze', name: 'Jaze', aliases: ['jaze'] }
    ]));
    fs.writeFileSync(path.join(sourceDataRoot, 'cves-list.json'), '{invalid json');
    fs.writeFileSync(path.join(sourceDataRoot, 'cves-local.json'), '[]');

    await assert.rejects(
        () => syncV1tData({ sourceRoot, targetRoot }),
        /Invalid JSON/
    );
    Object.entries(originals).forEach(([fileName, text]) => {
        assert.equal(fs.readFileSync(path.join(targetRoot, fileName), 'utf8'), text);
    });
});
