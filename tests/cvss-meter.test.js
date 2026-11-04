'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCvssScore, createCveView, extractMetric } = require('../scripts/cve-view');
const { renderCveDetailContent, renderCvssWidthStyles } = require('../scripts/generate-site');
const { renderDocument } = require('../scripts/site-shell');

function view(score, vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N') {
    return createCveView({ id: 'CVE-2026-999000', finders: ['Jaze'], record: {
        containers: { cna: { metrics: [{ cvssV3_1: { baseScore: score, vectorString: vector, baseSeverity: 'HIGH' } }] } }
    } });
}

test('CVSS accepts all 101 finite scores and rejects missing, coerced and malformed scores', () => {
    for (let n = 0; n <= 100; n++) {
        assert.equal(normalizeCvssScore(n / 10), n / 10);
        assert.equal(normalizeCvssScore((n / 10).toFixed(1)), n / 10);
    }
    for (const invalid of [null, undefined, '', ' ', false, true, [], {}, NaN, Infinity, -1, 11, 7.55, '7.5x', '1e1']) {
        assert.equal(normalizeCvssScore(invalid), null, `Reject ${String(invalid)}`);
    }
});

test('metric conversion preserves missing score and raw source, including vector-only records', () => {
    const record = { containers: { cna: { metrics: [{ cvssV3_1: { baseScore: null, vectorString: 'vector' } }] } } };
    const copy = JSON.stringify(record);
    assert.equal(extractMetric(record).baseScore, null);
    assert.equal(extractMetric(record).vector, 'vector');
    assert.equal(JSON.stringify(record), copy);
});

test('all 101 meter classes, visible labels and ARIA agree without inline width', () => {
    for (let n = 0; n <= 100; n++) {
        const score = n / 10;
        const html = renderCveDetailContent(view(score));
        assert.ok(html.includes(`cvss-fill--${n} `));
        assert.ok(html.includes(`aria-valuenow="${score}"`));
        assert.ok(html.includes(`aria-valuetext="${score.toFixed(1)} out of 10 (HIGH)"`));
        assert.match(html, /role="meter"/);
        assert.doesNotMatch(html, /\sstyle=/);
    }
});

test('unknown score omits meter, keeps N/A and vector/copy; zero still has a meter', () => {
    const html = renderCveDetailContent(view(null));
    assert.match(html, />N\/A<\/span>/);
    assert.doesNotMatch(html, /role="meter"|cvss-meter-bar/);
    assert.match(html, /data-copy-vector/);
    assert.match(renderCveDetailContent(view(0)), /cvss-fill--0 /);
    assert.doesNotMatch(renderCveDetailContent(view(null, '')), /cve-metrics-box/);
});

test('finite stylesheet is complete and deterministic, and linked only where used', () => {
    const css = renderCvssWidthStyles();
    assert.equal(css, renderCvssWidthStyles());
    // Also support the dev server's source-tree fallback before the first build.
    assert.equal(fs.readFileSync(path.join(__dirname, '../assets/css/cvss-widths.css'), 'utf8').replaceAll('\r\n', '\n'), css);
    assert.equal([...css.matchAll(/\.cvss-fill--\d+ /g)].length, 101);
    for (let n = 0; n <= 100; n++) assert.ok(css.includes(`.cvss-fill--${n} { width: ${n}%; }`));
    assert.match(renderDocument({ styles: ['cves.css'], body: '' }), /href="\/assets\/css\/cvss-widths.css"/);
    assert.doesNotMatch(renderDocument({ styles: ['blog.css'], body: '' }), /cvss-widths.css/);
});
