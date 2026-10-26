'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderPostContent, slugifyHeading } = require('../scripts/render-content');

test('typed post renderer escapes content and assigns stable unique heading ids', () => {
    const result = renderPostContent({
        slug: 'safe-rendering',
        content: [
            { type: 'heading', level: 2, text: 'Finding XSS' },
            { type: 'heading', level: 3, text: 'Finding XSS' },
            { type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
            { type: 'code', language: 'html', code: '<script>alert(1)</script>', filename: null, caption: null }
        ]
    });

    assert.match(result.html, /id="finding-xss"/);
    assert.match(result.html, /id="finding-xss-2"/);
    assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(result.html, /<script>alert/);
    assert.deepEqual(result.toc.map(item => item.id), ['finding-xss', 'finding-xss-2']);
});

test('heading slugs are deterministic and retain a safe fallback', () => {
    assert.equal(slugifyHeading('CVE Research: 2026'), 'cve-research-2026');
    assert.equal(slugifyHeading('---'), 'section');
});

test('image blocks reserve their declared aspect ratio', () => {
    const result = renderPostContent({
        slug: 'image-layout',
        content: [{
            type: 'image',
            src: '/assets/images/research/flow.png',
            alt: 'Request flow',
            caption: null,
            width: 1280,
            height: 720
        }]
    });
    assert.match(result.html, /width="1280" height="720"/);
});
