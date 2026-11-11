'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { renderDocument } = require('../scripts/site-shell');
const { generateSite } = require('../scripts/generate-site');
const { loadSiteData } = require('../scripts/load-site-data');
const { validateHtmlDocument } = require('../scripts/verify-build');
const { escapeHtml } = require('../scripts/render-utils');

const token = '9f4REY_tSanIOpOJ4EJSxwsVnXFgbIu16p3kEx38KpI';

function readSchemas(html) {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
}

test('ownership tag is emitted in homepage head without private-file dependencies or CSP changes', async () => {
    const home = renderDocument({ activePage: 'profile', scripts: ['intro-loader.js'], body: '<main><h1>Jaze</h1></main>' });
    const head = home.slice(home.indexOf('<head>'), home.indexOf('</head>'));
    assert.equal((head.match(/name="google-site-verification"/g) || []).length, 1);
    assert.ok(head.includes(`name="google-site-verification" content="${token}"`));
    assert.doesNotMatch(home, /unsafe-inline|unsafe-eval/);
    assert.doesNotThrow(() => validateHtmlDocument(home, 'index.html'));
    const article = renderDocument({ activePage: 'blog', pathname: '/blog/test/', body: '<main><h1>Post</h1></main>' });
    assert.doesNotMatch(article, /google-site-verification/);
    const shell = await fs.readFile(path.join(__dirname, '../scripts/site-shell.js'), 'utf8');
    assert.doesNotMatch(shell, /readFileSync\([^\n]*(?:note-jaze|html_tag\.txt)/);
});

test('generated homepage shares approved identity data without duplicating hero links or changing avatar', async t => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jaze-seo-'));
    t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
    const distRoot = path.join(temporaryRoot, 'dist');
    await generateSite({ distRoot });
    const data = await loadSiteData();
    const html = await fs.readFile(path.join(distRoot, 'index.html'), 'utf8');
    const person = readSchemas(html).find(schema => schema['@type'] === 'ProfilePage').mainEntity;
    assert.equal(person.description, data.profile.bio);
    assert.equal(person.name, data.profile.displayName);
    assert.deepEqual(person.sameAs, data.profile.socials.map(social => social.url));
    assert.deepEqual(new Set(person.sameAs), new Set([
        'https://github.com/trijaze', 'https://www.linkedin.com/in/trijaze/', 'https://ctftime.org/user/172832'
    ]));
    assert.ok(person.sameAs.every(url => !url.includes('google.com/search')));
    assert.equal(person.image, 'https://jaze.v1t.site/assets/images/jaze_v1t.png');
    assert.ok(html.includes(`<p class="hero-bio">${escapeHtml(data.profile.bio)}</p>`));
    assert.ok(html.includes(`name="description" content="${escapeHtml(`${data.profile.bio} Explore ${data.cves.length} CVE records.`)}"`));
    assert.ok(html.includes(`property="og:image" content="${person.image}"`));
    const hero = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)[1];
    assert.equal((hero.match(/https:\/\/ctftime\.org\/user\/172832/g) || []).length, 1);
    assert.doesNotMatch(hero, /github\.com|linkedin\.com/);
    const stats = html.match(/<section aria-label="Research statistics and social links"[\s\S]*?<\/section>/)[0];
    for (const label of ['GitHub', 'LinkedIn']) {
        const social = data.profile.socials.find(item => item.label === label);
        assert.equal(stats.split(`href="${escapeHtml(social.url)}"`).length - 1, 1);
    }
    for (const post of data.publishedPosts) {
        const postHtml = await fs.readFile(path.join(distRoot, 'blog', post.slug, 'index.html'), 'utf8');
        assert.doesNotMatch(postHtml, /google-site-verification/);
        assert.equal(readSchemas(postHtml).find(schema => schema['@type'] === 'BlogPosting').author.name, data.profile.displayName);
    }
    await assert.rejects(fs.access(path.join(distRoot, 'note-jaze')));
});
