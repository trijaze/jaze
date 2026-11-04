'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseFrontmatter,
    parseMarkdownToBlocks,
    calculateReadingMinutes
} = require('../scripts/compile-posts');

test('parseFrontmatter parses YAML frontmatter with tags, dates, and booleans', () => {
    const markdown = `---
title: "19 XSS in 24 Hours: Notes on Source Tracing"
slug: 19-xss-in-24-hours
excerpt: "A sprint through the plugin repository."
publishedAt: 2026-10-26
updatedAt: 2026-10-26
tags:
  - wordpress
  - xss
  - security
readingMinutes: 12
featured: true
status: published
---

# Title in Document

Body content goes here.
`;

    const { frontmatter, body } = parseFrontmatter(markdown);

    assert.equal(frontmatter.title, '19 XSS in 24 Hours: Notes on Source Tracing');
    assert.equal(frontmatter.slug, '19-xss-in-24-hours');
    assert.equal(frontmatter.excerpt, 'A sprint through the plugin repository.');
    assert.equal(frontmatter.publishedAt, '2026-10-26');
    assert.equal(frontmatter.updatedAt, '2026-10-26');
    assert.deepEqual(frontmatter.tags, ['wordpress', 'xss', 'security']);
    assert.equal(frontmatter.readingMinutes, 12);
    assert.equal(frontmatter.featured, true);
    assert.equal(frontmatter.status, 'published');
    assert.ok(body.includes('# Title in Document'));
    assert.ok(!body.includes('---'));
});

test('parseFrontmatter handles inline tags array and documents without frontmatter', () => {
    const withInlineTags = `---
title: Inline Tags Test
order: 1
tags: [cve, rce, critical]
featured: false
---
Some body text.`;

    const parsed1 = parseFrontmatter(withInlineTags);
    assert.equal(parsed1.frontmatter.title, 'Inline Tags Test');
    assert.equal(parsed1.frontmatter.order, 1);
    assert.deepEqual(parsed1.frontmatter.tags, ['cve', 'rce', 'critical']);
    assert.equal(parsed1.frontmatter.featured, false);
    assert.equal(parsed1.body.trim(), 'Some body text.');

    const noFrontmatter = `# Just Markdown\n\nNo frontmatter here.`;
    const parsed2 = parseFrontmatter(noFrontmatter);
    assert.deepEqual(parsed2.frontmatter, {});
    assert.equal(parsed2.body, noFrontmatter);
});

test('calculateReadingMinutes calculates realistic reading time based on 200 WPM', () => {
    const shortText = 'One two three four five';
    assert.equal(calculateReadingMinutes(shortText), 1);

    const words = Array.from({ length: 450 }, (_, i) => `word${i}`).join(' ');
    assert.equal(calculateReadingMinutes(words), 3); // 450 / 200 = 2.25 -> ceil = 3
});

test('parseMarkdownToBlocks correctly parses GFM tables with alignments', () => {
    const md = `## Security Findings

| Vulnerability Type | CVSS | Vector | Status |
| :--- | :---: | ---: | --- |
| Unauth RCE | 9.8 | Network | Verified |
| Stored XSS | 6.1 | Web | Patched |

A follow-up paragraph.`;

    const blocks = parseMarkdownToBlocks(md);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'heading');
    assert.equal(blocks[1].type, 'table');
    assert.deepEqual(blocks[1].headers, ['Vulnerability Type', 'CVSS', 'Vector', 'Status']);
    assert.deepEqual(blocks[1].alignments, ['left', 'center', 'right', 'left']);
    assert.deepEqual(blocks[1].rows, [
        ['Unauth RCE', '9.8', 'Network', 'Verified'],
        ['Stored XSS', '6.1', 'Web', 'Patched']
    ]);
    assert.equal(blocks[2].type, 'paragraph');
    assert.equal(blocks[2].text, 'A follow-up paragraph.');
});

test('parseMarkdownToBlocks parses task lists with checkboxes', () => {
    const md = `## Checklist

- [x] Initial vulnerability assessment completed
- [ ] Patch verification pending
- [x] Advisory published
`;

    const blocks = parseMarkdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'heading');
    assert.equal(blocks[1].type, 'list');
    assert.equal(blocks[1].style, 'unordered');
    assert.deepEqual(blocks[1].items, [
        '[x] Initial vulnerability assessment completed',
        '[ ] Patch verification pending',
        '[x] Advisory published'
    ]);
});

test('parseMarkdownToBlocks correctly parses images with alt, url, and optional caption', () => {
    const md = `## Evidence

![Stegsolve bit plane 6](/assets/images/posts/v1t-ctf-2025/67-bitplane6.png "Bit plane analysis")

Following observation.`;

    const blocks = parseMarkdownToBlocks(md);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'heading');
    assert.equal(blocks[1].type, 'image');
    assert.equal(blocks[1].alt, 'Stegsolve bit plane 6');
    assert.equal(blocks[1].src, '/assets/images/posts/v1t-ctf-2025/67-bitplane6.png');
    assert.equal(blocks[1].caption, 'Bit plane analysis');
    assert.ok(blocks[1].width > 0);
    assert.ok(blocks[1].height > 0);
    assert.equal(blocks[2].type, 'paragraph');
    assert.equal(blocks[2].text, 'Following observation.');
});

