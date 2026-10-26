'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const defaultDistRoot = path.join(projectRoot, 'dist');
const SITE_ORIGIN = 'https://jaze.v1t.site';
const REQUIRED_FILES = Object.freeze([
    'index.html',
    'blog/index.html',
    'cves/index.html',
    '404.html',
    'sitemap.xml',
    'feed.xml',
    'robots.txt',
    'CNAME',
    '.nojekyll',
    'build-manifest.json'
]);

function parseArgs(argv) {
    let distRoot = defaultDistRoot;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--dir') {
            const value = argv[index + 1];
            if (!value) throw new Error('--dir requires a directory path.');
            distRoot = path.resolve(value);
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    return { distRoot };
}

function assertIncludes(text, pattern, message) {
    if (!pattern.test(text)) throw new Error(message);
}

function validateHtmlDocument(html, relativePath) {
    assertIncludes(html, /^<!doctype html>/i, `${relativePath}: missing HTML doctype.`);
    assertIncludes(html, /<html\s[^>]*lang=["']en["']/i, `${relativePath}: missing English document language.`);
    assertIncludes(html, /<meta\s[^>]*name=["']viewport["']/i, `${relativePath}: missing viewport metadata.`);
    assertIncludes(html, /<meta\s[^>]*name=["']theme-color["']/i, `${relativePath}: missing theme-color metadata.`);
    const cspMatch = html.match(/<meta\s[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"']+)["']/i);
    if (!cspMatch) throw new Error(`${relativePath}: missing Content Security Policy metadata.`);
    if (/unsafe-inline|unsafe-eval/i.test(cspMatch[1])) {
        throw new Error(`${relativePath}: CSP must not allow unsafe-inline or unsafe-eval.`);
    }
    assertIncludes(html, /<title>[^<]+<\/title>/i, `${relativePath}: missing a non-empty title.`);
    assertIncludes(html, /<meta\s[^>]*name=["']description["'][^>]*content=["'][^"']+["']/i,
        `${relativePath}: missing a non-empty meta description.`);
    assertIncludes(html, /<link\s[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/jaze\.v1t\.site(?:\/[^"']*)?["']/i,
        `${relativePath}: missing an absolute production canonical URL.`);
    assertIncludes(html, /<meta\s[^>]*property=["']og:title["']/i, `${relativePath}: missing og:title.`);
    assertIncludes(html, /<meta\s[^>]*property=["']og:description["']/i, `${relativePath}: missing og:description.`);
    assertIncludes(html, /<meta\s[^>]*property=["']og:url["']/i, `${relativePath}: missing og:url.`);
    assertIncludes(html, /<meta\s[^>]*name=["']twitter:card["']/i, `${relativePath}: missing Twitter card metadata.`);

    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) throw new Error(`${relativePath}: expected exactly one h1, found ${h1Count}.`);

    for (const match of html.matchAll(/<script\s[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            JSON.parse(match[1]);
        } catch (error) {
            throw new Error(`${relativePath}: invalid JSON-LD: ${error.message}`);
        }
        const expectedHash = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
        if (!html.includes(`sha256-${expectedHash}`)) {
            throw new Error(`${relativePath}: CSP does not allow its JSON-LD payload.`);
        }
    }

    const robotsMatch = html.match(/<meta\s[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i);
    if (!robotsMatch) throw new Error(`${relativePath}: missing robots metadata.`);
    const isNotFoundPage = relativePath === '404.html';
    const hasNoIndex = /\bnoindex\b/i.test(robotsMatch[1]);
    if (isNotFoundPage && !hasNoIndex) throw new Error('404.html: expected noindex robots metadata.');
    if (!isNotFoundPage && hasNoIndex) throw new Error(`${relativePath}: generated public page must not be noindex.`);

    if (/\{\{[^}]+\}\}|__[A-Z0-9_]+__/.test(html)) {
        throw new Error(`${relativePath}: unresolved template placeholder found.`);
    }
}

async function listFilesRecursively(root) {
    const results = [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            results.push(...await listFilesRecursively(absolutePath));
        } else if (entry.isFile()) {
            results.push(absolutePath);
        }
    }
    return results;
}

function extractLocalReferences(html) {
    const references = [];
    const attributePattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
    for (const match of html.matchAll(attributePattern)) {
        const value = match[2].trim();
        if (value.startsWith('/') && !value.startsWith('//')) references.push(value);
    }
    return references;
}

function referenceCandidates(distRoot, reference) {
    const url = new URL(reference, SITE_ORIGIN);
    const decodedPath = decodeURIComponent(url.pathname);
    const relativePath = decodedPath.replace(/^\/+/, '');
    if (!relativePath) return [path.join(distRoot, 'index.html')];

    const directPath = path.join(distRoot, ...relativePath.split('/'));
    if (decodedPath.endsWith('/')) return [path.join(directPath, 'index.html')];
    if (path.extname(relativePath)) return [directPath];
    return [directPath, path.join(directPath, 'index.html')];
}

async function assertLocalReferencesExist(distRoot, htmlFiles) {
    const missing = new Set();
    for (const htmlPath of htmlFiles) {
        const html = await fs.readFile(htmlPath, 'utf8');
        const relativeHtmlPath = path.relative(distRoot, htmlPath).replaceAll('\\', '/');
        for (const reference of extractLocalReferences(html)) {
            const candidates = referenceCandidates(distRoot, reference);
            let exists = false;
            for (const candidate of candidates) {
                try {
                    const stats = await fs.stat(candidate);
                    if (stats.isFile()) {
                        exists = true;
                        break;
                    }
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
            if (!exists) missing.add(`${relativeHtmlPath} -> ${reference}`);
        }
    }

    if (missing.size) {
        throw new Error(`Broken local output reference(s):\n${[...missing].sort().join('\n')}`);
    }
}

async function verifyBuild(options = {}) {
    const distRoot = path.resolve(options.distRoot || defaultDistRoot);
    const missingRequired = [];
    for (const relativePath of REQUIRED_FILES) {
        try {
            const stats = await fs.stat(path.join(distRoot, relativePath));
            if (!stats.isFile()) missingRequired.push(relativePath);
        } catch (error) {
            if (error.code === 'ENOENT') missingRequired.push(relativePath);
            else throw error;
        }
    }
    if (missingRequired.length) {
        throw new Error(`Missing required build output: ${missingRequired.join(', ')}`);
    }

    const files = await listFilesRecursively(distRoot);
    const htmlFiles = files.filter(filePath => filePath.toLowerCase().endsWith('.html'));
    if (htmlFiles.length < 5) {
        throw new Error(`Expected generated route pages, found only ${htmlFiles.length} HTML file(s).`);
    }
    if (!htmlFiles.some(filePath => /[\\/]cves[\\/]CVE-[^\\/]+[\\/]index\.html$/i.test(filePath))) {
        throw new Error('No generated CVE detail page was found.');
    }

    const canonicalUrls = new Map();
    for (const htmlPath of htmlFiles) {
        const relativePath = path.relative(distRoot, htmlPath).replaceAll('\\', '/');
        const html = await fs.readFile(htmlPath, 'utf8');
        validateHtmlDocument(html, relativePath);
        const canonical = html.match(/<link\s[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
        if (canonical) {
            const existingPath = canonicalUrls.get(canonical);
            if (existingPath && relativePath !== '404.html' && existingPath !== '404.html') {
                throw new Error(`Duplicate canonical URL in ${existingPath} and ${relativePath}: ${canonical}`);
            }
            canonicalUrls.set(canonical, relativePath);
        }
    }

    await assertLocalReferencesExist(distRoot, htmlFiles);

    const [cname, sitemap, feed, robots] = await Promise.all([
        fs.readFile(path.join(distRoot, 'CNAME'), 'utf8'),
        fs.readFile(path.join(distRoot, 'sitemap.xml'), 'utf8'),
        fs.readFile(path.join(distRoot, 'feed.xml'), 'utf8'),
        fs.readFile(path.join(distRoot, 'robots.txt'), 'utf8')
    ]);
    if (cname.trim() !== 'jaze.v1t.site') throw new Error('CNAME must contain exactly jaze.v1t.site.');
    assertIncludes(sitemap, /<urlset\b/i, 'sitemap.xml does not contain a urlset root.');
    assertIncludes(sitemap, /https:\/\/jaze\.v1t\.site\//i, 'sitemap.xml does not contain the production origin.');
    assertIncludes(feed, /<(?:rss|feed)\b/i, 'feed.xml is not an RSS or Atom document.');
    assertIncludes(robots, /Sitemap:\s*https:\/\/jaze\.v1t\.site\/sitemap\.xml/i,
        'robots.txt does not advertise the production sitemap.');

    return {
        distRoot,
        fileCount: files.length,
        htmlCount: htmlFiles.length,
        canonicalCount: canonicalUrls.size
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = await verifyBuild(options);
    console.log(
        `Verified ${summary.fileCount} build artifact(s), ${summary.htmlCount} HTML page(s), `
        + `${summary.canonicalCount} canonical URL(s).`
    );
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Build verification failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({
    REQUIRED_FILES,
    defaultDistRoot,
    extractLocalReferences,
    parseArgs,
    referenceCandidates,
    validateHtmlDocument,
    verifyBuild
});
