'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    extractLocalReferences,
    validateHtmlDocument,
    verifyBuild
} = require('../scripts/verify-build');

function renderFixtureHtml(canonicalPath, robots = 'index, follow') {
    return `<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#020c00">
    <meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39;">
    <meta name="robots" content="${robots}">
    <link rel="canonical" href="https://jaze.v1t.site${canonicalPath}">
    <title>Fixture page</title>
    <meta name="description" content="Build verifier fixture page.">
    <meta property="og:title" content="Fixture page">
    <meta property="og:description" content="Build verifier fixture page.">
    <meta property="og:url" content="https://jaze.v1t.site${canonicalPath}">
    <meta name="twitter:card" content="summary_large_image">
</head>
<body><main><h1>Fixture</h1></main></body>
</html>`;
}

async function writeFixture(root, relativePath, content) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
}

test('HTML validation rejects noindex on a public generated route', () => {
    assert.throws(
        () => validateHtmlDocument(renderFixtureHtml('/blog/', 'noindex, nofollow'), 'blog/index.html'),
        /must not be noindex/
    );
});

test('local reference extraction ignores external and protocol-relative URLs', () => {
    const references = extractLocalReferences(`
        <a href="/blog/">Blog</a>
        <img src="/assets/avatar.png" alt="">
        <a href="https://example.com/">External</a>
        <script src="//cdn.example.com/app.js"></script>
    `);
    assert.deepEqual(references, ['/blog/', '/assets/avatar.png']);
});

test('build verification accepts a complete static fixture', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jaze-build-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    await Promise.all([
        writeFixture(root, 'index.html', renderFixtureHtml('/')),
        writeFixture(root, 'blog/index.html', renderFixtureHtml('/blog/')),
        writeFixture(root, 'cves/index.html', renderFixtureHtml('/cves/')),
        writeFixture(root, 'cves/CVE-2026-1000/index.html', renderFixtureHtml('/cves/CVE-2026-1000/')),
        writeFixture(root, '404.html', renderFixtureHtml('/404.html', 'noindex, nofollow')),
        writeFixture(root, 'sitemap.xml', '<urlset><url><loc>https://jaze.v1t.site/</loc></url></urlset>'),
        writeFixture(root, 'feed.xml', '<rss version="2.0"><channel></channel></rss>'),
        writeFixture(root, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://jaze.v1t.site/sitemap.xml\n'),
        writeFixture(root, 'CNAME', 'jaze.v1t.site\n'),
        writeFixture(root, '.nojekyll', ''),
        writeFixture(root, 'build-manifest.json', '{"schemaVersion":1}\n')
    ]);

    const summary = await verifyBuild({ distRoot: root });
    assert.equal(summary.htmlCount, 5);
    assert.equal(summary.canonicalCount, 5);
});
