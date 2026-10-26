'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchMitreRecord } = require('../scripts/update-cves');

function response(record, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 404 ? 'Not Found' : 'OK',
        async json() { return record; }
    };
}

test('MITRE fetch accepts only a response with the requested CVE id', async () => {
    const expected = { cveMetadata: { cveId: 'CVE-2026-1000' } };
    assert.equal(await fetchMitreRecord('CVE-2026-1000', {
        fetchImpl: async () => response(expected),
        timeoutMs: 50
    }), expected);

    await assert.rejects(
        fetchMitreRecord('CVE-2026-1000', {
            fetchImpl: async () => response({ cveMetadata: { cveId: 'CVE-2026-9999' } }),
            timeoutMs: 50
        }),
        /response id mismatch/
    );
});

test('MITRE fetch aborts a stalled request at its timeout', async () => {
    const stalledFetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });

    await assert.rejects(
        fetchMitreRecord('CVE-2026-1000', { fetchImpl: stalledFetch, timeoutMs: 10 }),
        error => error.name === 'TimeoutError'
    );
});

test('MITRE fetch preserves HTTP status failures for reserved handling', async () => {
    await assert.rejects(
        fetchMitreRecord('CVE-2026-1000', {
            fetchImpl: async () => response({}, 404),
            timeoutMs: 50
        }),
        error => error.status === 404
    );
});
