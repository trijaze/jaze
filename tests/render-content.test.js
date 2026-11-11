'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { getPublishedPosts, normalizePostDocument } = require('../scripts/content-contracts');
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
    assert.match(result.html, /<th scope="col" class="table-align-center">Target<\/th>/);
    for (const alignment of ['left', 'center', 'right']) {
        assert.match(result.html, new RegExp(`<th scope="col" class="table-align-${alignment}">`));
        assert.equal((result.html.match(new RegExp(`<td class="table-align-${alignment}">`, 'g')) || []).length, 2);
    }
    assert.doesNotMatch(result.html, /\sstyle\s*=/i);
    assert.match(result.html, /<code>move_uploaded_file\(\)<\/code>/);
    assert.match(result.html, /<strong>Critical<\/strong>/);
});

test('tables retain default alignment when unspecified and never interpolate unknown alignment classes', () => {
    for (const alignments of [undefined, null, [], ['', null, 'right'], ['justify', 'center" onclick="alert(1)', 'toString']]) {
        const result = renderPostContent({ slug: 'table-defaults', content: [{
            type: 'table', headers: ['One', 'Two', 'Three'], rows: [['A', '<img src=x>', 'C']], alignments
        }] });
        assert.match(result.html, /<th scope="col">One<\/th>/);
        assert.match(result.html, /<td>&lt;img src=x&gt;<\/td>/);
        assert.doesNotMatch(result.html, /\s(?:style|onclick)\s*=|table-align-(?:justify|toString)/i);
        assert.equal((result.html.match(/class="table-align-/g) || []).length, alignments?.[2] === 'right' ? 2 : 0);
    }
});

test('every published table emits only CSP-safe alignment classes supported by blog CSS', async () => {
    const root = path.resolve(__dirname, '..');
    const posts = getPublishedPosts(JSON.parse(await fs.readFile(path.join(root, 'assets/data/posts-list.json'), 'utf8')));
    const css = await fs.readFile(path.join(root, 'assets/css/blog.css'), 'utf8');
    for (const alignment of ['left', 'center', 'right']) {
        assert.match(css, new RegExp(`\\.post-table \\.table-align-${alignment}\\s*\\{\\s*text-align:\\s*${alignment};\\s*\\}`));
    }
    for (const post of posts) {
        const document = normalizePostDocument(JSON.parse(await fs.readFile(path.join(root, 'assets/data/posts', `${post.slug}.json`), 'utf8')));
        const html = renderPostContent(document).html;
        assert.doesNotMatch(html, /<(?:th|td)\b[^>]*\sstyle\s*=/i, post.slug);
        for (const alignment of ['left', 'center', 'right']) {
            const expected = document.content.filter(block => block.type === 'table').reduce((sum, block) =>
                sum + (block.alignments || []).filter(value => value === alignment).length * (block.rows.length + 1), 0);
            assert.equal((html.match(new RegExp(`class="table-align-${alignment}"`, 'g')) || []).length, expected, `${post.slug}: ${alignment}`);
        }
    }
});

test('math equation rendering correctly converts LaTeX formulas into accessible HTML blocks', () => {
    const result = renderPostContent({
        slug: 'math-test',
        content: [
            {
                type: 'paragraph',
                text: '$$\\text{Token}[i] = \\text{AUTH\\_MAGIC}[i] \\oplus \\text{Nonce}[i] \\oplus \\text{Key}[i]$$'
            },
            {
                type: 'paragraph',
                text: 'Outer layer is keyed by $\\text{SHA256}(\\text{MAC} \\parallel \\text{Nonce})$.'
            },
            {
                type: 'paragraph',
                text: 'For each iteration $j \\in [0, 15]$, the top 8 bits of state `(S[j+1] >> 24) & 0xFF` are appended to form a 16-byte key.'
            },
            {
                type: 'paragraph',
                text: '$$S_{n+1} = (S_n \\times \\text{MUL} + \\text{ADD}) \\pmod{2^{32}}$$'
            },
            {
                type: 'paragraph',
                text: '$$\\text{Plaintext}[i] = \\text{ENC\\_TOTAL}[i] \\oplus (i \\ \\& \\ \\text{0xFF}) \\oplus \\text{Key}[i \\pmod{16}]$$'
            },
            {
                type: 'paragraph',
                text: 'PHP variable `$total = $a + $b;` is unmodified.'
            }
        ]
    });

    assert.match(result.html, /<div class="math-block" role="region" aria-label="Mathematical formula">/);
    assert.match(result.html, /Token\[i\] = AUTH_MAGIC\[i\] ⊕ Nonce\[i\] ⊕ Key\[i\]/);
    assert.match(result.html, /<span class="math-inline">SHA256\(MAC ∥ Nonce\)<\/span>/);
    assert.match(result.html, /<span class="math-inline">j ∈ \[0, 15\]<\/span>/);
    assert.match(result.html, /<code>\(S\[j\+1\] &gt;&gt; 24\) &amp; 0xFF<\/code>/);
    assert.match(result.html, /S<sub>n\+1<\/sub> = \(S<sub>n<\/sub> × MUL \+ ADD\) \(mod 2<sup>32<\/sup>\)/);
    assert.match(result.html, /Plaintext\[i\] = ENC_TOTAL\[i\] ⊕ \(i  &amp;  0xFF\) ⊕ Key\[i \(mod 16\)\]/);
    assert.match(result.html, /<code>\$total = \$a \+ \$b;<\/code>/);
});

test('mermaid code blocks render accessible visual state transition flowcharts', () => {
    const result = renderPostContent({
        slug: 'flowchart-test',
        content: [{
            type: 'code',
            language: 'mermaid',
            code: 'flowchart TD\nStateA["Node A\\nSubtitle"]\nStateB["Node B"]\nStateA -->|"Step 1"| StateB\nclass StateA warning;\nclass StateB success;'
        }]
    });

    assert.match(result.html, /<figure class="flowchart-figure" role="region" aria-label="Flowchart diagram"/);
    assert.match(result.html, /STATE TRANSITION FLOWCHART/);
    assert.match(result.html, /class="flowchart-step flowchart-tone-warning" id="step-StateA"/);
    assert.match(result.html, /<strong class="flowchart-node__title">Node A<\/strong>/);
    assert.match(result.html, /<div class="flowchart-node__sub">Subtitle<\/div>/);
    assert.match(result.html, /class="flowchart-step flowchart-tone-success" id="step-StateB"/);
    assert.match(result.html, /<span class="flowchart-connector__badge">Step 1<\/span>/);
    assert.match(result.html, /<svg class="flowchart-connector__arrow"/);
});
