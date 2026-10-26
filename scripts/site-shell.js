'use strict';

const crypto = require('node:crypto');

const {
    SITE_ORIGIN,
    absoluteUrl,
    escapeHtml,
    escapeJsonForHtml,
    normalizePathname
} = require('./render-utils');

const DEFAULT_DESCRIPTION = 'Security research profile, technical publications, and verified CVE disclosures by Jaze.';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/assets/images/jaze_v1t.png`;

function renderNavigation(activePage = '') {
    const navItems = [
        { id: 'profile', href: '/', label: 'Profile' },
        { id: 'blog', href: '/blog/', label: 'Blog' },
        { id: 'cves', href: '/cves/', label: 'CVEs' },
        { id: 'v1t', href: 'https://v1t.site/', label: 'V1T', external: true }
    ];

    const links = navItems.map(item => {
        const current = item.id === activePage ? ' aria-current="page"' : '';
        const external = item.external ? ' rel="external"' : '';
        return `<li><a href="${escapeHtml(item.href)}"${current}${external}>${escapeHtml(item.label)}</a></li>`;
    }).join('');

    return `
    <header class="site-header">
        <nav class="site-nav site-shell" aria-label="Primary navigation">
            <a class="site-wordmark" href="/" aria-label="Jaze home">JAZE<span aria-hidden="true">_</span></a>
            <button class="nav-toggle" type="button" aria-controls="primary-menu" aria-expanded="false" aria-label="Open navigation menu" data-nav-toggle>
                <span class="nav-toggle-lines" aria-hidden="true"></span>
            </button>
            <ul class="nav-links" id="primary-menu" data-nav-menu>${links}</ul>
        </nav>
    </header>`;
}

function renderFooter() {
    return `
    <footer class="site-footer">
        <div class="site-shell footer-layout">
            <p>Jaze · Security Research · <a href="https://v1t.site/" rel="external">V1T</a></p>
            <nav aria-label="Footer navigation">
                <a href="/feed.xml">RSS</a>
                <a href="/sitemap.xml">Sitemap</a>
            </nav>
        </div>
    </footer>`;
}

function renderDocument({
    title,
    description = DEFAULT_DESCRIPTION,
    pathname = '/',
    activePage = '',
    body,
    styles = [],
    scripts = [],
    structuredData = [],
    image = DEFAULT_IMAGE,
    imageAlt = 'Jaze security research profile',
    pageType = 'website',
    robots = 'index, follow, max-image-preview:large'
}) {
    const normalizedPath = normalizePathname(pathname);
    const canonical = absoluteUrl(normalizedPath);
    const pageTitle = String(title || 'Jaze — Security Researcher');
    const pageDescription = String(description || DEFAULT_DESCRIPTION);
    const stylesheetLinks = ['tokens.css', 'base.css', 'nav.css', ...styles]
        .map(file => `    <link rel="stylesheet" href="/assets/css/${escapeHtml(file)}">`)
        .join('\n');
    const scriptTags = ['nav.js', ...scripts]
        .map(file => `    <script src="/assets/js/${escapeHtml(file)}" defer></script>`)
        .join('\n');
    const schemaPayloads = structuredData
        .filter(Boolean)
        .map(escapeJsonForHtml);
    const schemas = schemaPayloads
        .map(payload => `    <script type="application/ld+json">${payload}</script>`)
        .join('\n');
    const schemaHashes = schemaPayloads.map(payload =>
        `'sha256-${crypto.createHash('sha256').update(payload, 'utf8').digest('base64')}'`
    );
    const contentSecurityPolicy = [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self' https://cveawg.mitre.org",
        "font-src 'self'",
        "form-action 'self'",
        "frame-src 'none'",
        "img-src 'self' data: https:",
        "object-src 'none'",
        `script-src 'self'${schemaHashes.length ? ` ${schemaHashes.join(' ')}` : ''}`,
        "style-src 'self'",
        "worker-src 'none'"
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#020c00">
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">
    <meta name="robots" content="${escapeHtml(robots)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="alternate" type="application/rss+xml" title="Jaze research feed" href="/feed.xml">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(pageDescription)}">
    <meta name="author" content="Jaze">
    <meta property="og:site_name" content="Jaze Security Research">
    <meta property="og:type" content="${escapeHtml(pageType)}">
    <meta property="og:title" content="${escapeHtml(pageTitle)}">
    <meta property="og:description" content="${escapeHtml(pageDescription)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
    <meta name="twitter:description" content="${escapeHtml(pageDescription)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">
${stylesheetLinks}
${schemas}
${scriptTags}
</head>
<body data-page="${escapeHtml(activePage)}">
    <a class="skip-link" href="#main-content">Skip to main content</a>
${renderNavigation(activePage)}
${body}
${renderFooter()}
</body>
</html>
`;
}

module.exports = Object.freeze({
    DEFAULT_DESCRIPTION,
    DEFAULT_IMAGE,
    renderDocument,
    renderFooter,
    renderNavigation
});
