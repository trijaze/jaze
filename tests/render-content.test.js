'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderInlineMarkdown, renderPostContent, slugifyHeading } = require('../scripts/render-content');

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

test('renderInlineMarkdown safely parses bold, code, links, and rejects unsafe schemes', () => {
    assert.equal(
        renderInlineMarkdown('This is **bold** and `code`'),
        'This is <strong>bold</strong> and <code>code</code>'
    );
    assert.equal(
        renderInlineMarkdown('Check [CVE archive](/cves/) and [External](https://example.com)'),
        'Check <a href="/cves/">CVE archive</a> and <a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>'
    );
    // Unsafe schemes must NOT become active links
    assert.equal(
        renderInlineMarkdown('[Attack](javascript:alert(1))'),
        '[Attack](javascript:alert(1))'
    );
    // HTML inside inline markdown is escaped
    assert.equal(
        renderInlineMarkdown('`<b>not bold</b>` <script>bad()</script>'),
        '<code>&lt;b&gt;not bold&lt;/b&gt;</code> &lt;script&gt;bad()&lt;/script&gt;'
    );
});

test('table blocks render accessible HTML table with alignments and captions', () => {
    const result = renderPostContent({
        slug: 'table-test',
        content: [{
            type: 'table',
            caption: 'Audited Sinks',
            headers: ['Type', 'Target', 'Severity'],
            alignments: ['left', 'center', 'right'],
            rows: [
                ['AFU', '`move_uploaded_file()`', '**Critical**'],
                ['SQLi', '`$wpdb->get_results()`', '**High**']
            ]
        }]
    });

    assert.match(result.html, /<table class="post-table">/);
    assert.match(result.html, /<caption>Audited Sinks<\/caption>/);
    assert.match(result.html, /<th scope="col" style="text-align: center;">Target<\/th>/);
    assert.match(result.html, /<code>move_uploaded_file\(\)<\/code>/);
    assert.match(result.html, /<strong>Critical<\/strong>/);
});
