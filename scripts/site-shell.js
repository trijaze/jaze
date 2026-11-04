'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Normalize line endings so the CSP hashes match the exact emitted payload on
// both Windows checkouts and the Linux Pages build.
const startupScript = fs.readFileSync(path.join(__dirname, '../assets/js/startup-bootstrap.js'), 'utf8').replace(/\r\n/g, '\n');
const startupStyle = fs.readFileSync(path.join(__dirname, '../assets/css/startup-critical.css'), 'utf8').replace(/\r\n/g, '\n');
const cspHash = payload => `'sha256-${crypto.createHash('sha256').update(payload, 'utf8').digest('base64')}'`;

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

    const isBlurDefaultOn = activePage !== 'profile';

    return `
    <header class="site-header">
        <nav class="site-nav site-shell" aria-label="Primary navigation">
            <a class="site-wordmark" href="/" aria-label="Jaze home">JAZE<span aria-hidden="true">_</span></a>
            <div class="nav-actions">
                <button class="nav-blur-switch" id="nav-blur-switch" type="button" role="switch" aria-checked="${isBlurDefaultOn ? 'true' : 'false'}" aria-label="Toggle background blur" title="Toggle background blur (B)">
                    <span class="nav-blur-switch__track" aria-hidden="true">
                        <span class="nav-blur-switch__thumb"></span>
                    </span>
                </button>
                <button class="nav-brightness-btn" id="nav-brightness-btn" type="button" aria-pressed="false" aria-label="Toggle 3x green brightness boost" title="Boost green brightness 3x (L)">
                    <svg class="nav-brightness-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="5"></circle>
                        <line x1="12" y1="1" x2="12" y2="3"></line>
                        <line x1="12" y1="21" x2="12" y2="23"></line>
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                        <line x1="1" y1="12" x2="3" y2="12"></line>
                        <line x1="21" y1="12" x2="23" y2="12"></line>
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                    </svg>
                </button>
                <button class="nav-toggle" type="button" aria-controls="primary-menu" aria-expanded="false" aria-label="Open navigation menu" data-nav-toggle>
                    <span class="nav-toggle-lines" aria-hidden="true"></span>
                </button>
            </div>
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
                <button type="button" class="footer-feed-trigger" data-open-feed-me>Feed Me</button>
                <a href="/feed.xml">RSS</a>
                <a href="/sitemap.xml">Sitemap</a>
            </nav>
        </div>
    </footer>`;
}

function renderFeedMeDialog() {
    const btcAddress = 'bc1qyd2v6ld279uqkqjkardhd4y2em8qlrr2zk5r97';
    const ethAddress = '0x40f75CDFd70b8F665df1E226bBe0446E2A7E41c0';

    return `
    <dialog class="feed-me-dialog" id="feed-me-dialog" aria-labelledby="feed-me-dialog-title">
        <div class="feed-me-dialog__surface">
            <div class="feed-me-dialog__header">
                <div>
                    <span class="feed-me-dialog__tag">DONATE / TIP JAR</span>
                    <h2 id="feed-me-dialog-title" class="feed-me-dialog__title">Feed Me<span class="feed-me-cursor" aria-hidden="true">_</span></h2>
                </div>
                <button type="button" class="feed-me-dialog__close" data-close-feed-me aria-label="Close dialog">&times;</button>
            </div>

            <p class="feed-me-dialog__desc">Support vulnerability research, hardware exploits & caffeine.</p>

            <div class="feed-me-list">
                <!-- Bitcoin -->
                <div class="feed-me-item">
                    <div class="feed-me-item__label">
                        <span class="feed-me-item__name">Bitcoin</span>
                        <span class="feed-me-item__chain">BTC (Native SegWit)</span>
                    </div>
                    <div class="feed-me-item__field">
                        <code class="feed-me-item__addr" title="${btcAddress}">${btcAddress}</code>
                        <button type="button" class="feed-me-copy-btn" data-copy-crypto="${btcAddress}" aria-label="Copy Bitcoin address">
                            <span class="feed-me-copy-text">Copy</span>
                        </button>
                    </div>
                </div>

                <!-- Ethereum -->
                <div class="feed-me-item">
                    <div class="feed-me-item__label">
                        <span class="feed-me-item__name">Ethereum</span>
                        <span class="feed-me-item__chain">ETH (EVM / L2s)</span>
                    </div>
                    <div class="feed-me-item__field">
                        <code class="feed-me-item__addr" title="${ethAddress}">${ethAddress}</code>
                        <button type="button" class="feed-me-copy-btn" data-copy-crypto="${ethAddress}" aria-label="Copy Ethereum address">
                            <span class="feed-me-copy-text">Copy</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </dialog>`;
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
    const hasIntro = scripts.includes('intro-loader.js') && activePage === 'profile';
    const stylesheetLinks = ['tokens.css', 'base.css', 'nav.css', ...styles, ...(styles.includes('cves.css') ? ['cvss-widths.css'] : [])]
        .map(file => `    <link rel="stylesheet" href="/assets/css/${escapeHtml(file)}">`)
        .join('\n');
    // Discover render-blocking CSS first, then preload only the key font files.
    // This avoids font requests occupying all HTTP/1.1 slots ahead of CSS.
    const fontPreloads = hasIntro ? [
        'Anta/Anta-Regular.ttf', 'Chakra_Petch/ChakraPetch-Regular.ttf',
        'Chakra_Petch/ChakraPetch-Bold.ttf', 'IBM_Plex_Mono/IBMPlexMono-Bold.ttf'
    ].map(file => `    <link rel="preload" href="/assets/fonts/${file}" as="font" type="font/ttf" crossorigin>`).join('\n') : '';
    const defaultScripts = ['intro-controller.js', 'nav.js', 'ascii-webgl-renderer.js', 'intro-loader.js'];
    const allScripts = [...new Set([...defaultScripts, ...scripts])];
    const scriptTags = allScripts
        .map(file => `    <script src="/assets/js/${escapeHtml(file)}" defer></script>`)
        .join('\n');
    const schemaPayloads = structuredData
        .filter(Boolean)
        .map(escapeJsonForHtml);
    const schemas = schemaPayloads
        .map(payload => `    <script type="application/ld+json">${payload}</script>`)
        .join('\n');
    const scriptHashes = [...schemaPayloads.map(cspHash), ...(hasIntro ? [cspHash(startupScript)] : [])];
    const contentSecurityPolicy = [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self' https://cveawg.mitre.org",
        "font-src 'self'",
        "form-action 'self'",
        "frame-src 'none'",
        "img-src 'self' data: https:",
        "object-src 'none'",
        `script-src 'self'${scriptHashes.length ? ` ${scriptHashes.join(' ')}` : ''}`,
        `style-src 'self'${hasIntro ? ` ${cspHash(startupStyle)}` : ''}`,
        "worker-src 'none'"
    ].join('; ');

    const isBlurDefaultOn = activePage !== 'profile';
    const bodyClasses = [];
    if (isBlurDefaultOn) bodyClasses.push('bg-blur-active');
    const bodyClass = bodyClasses.length ? ` class="${bodyClasses.join(' ')}"` : '';

    return `<!doctype html>
<html lang="en"${hasIntro ? ' data-intro="true"' : ''}>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#020c00">
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">
${hasIntro ? `    <style data-startup-critical>${startupStyle}</style>\n    <script data-startup-bootstrap>${startupScript}</script>` : ''}
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
${fontPreloads}
${schemas}
${scriptTags}
</head>
<body${bodyClass} data-page="${escapeHtml(activePage)}" data-intro="${String(hasIntro)}">
    <div class="site-spatial-bg site-spatial-bg--intro" data-spatial-bg aria-hidden="true">
        <canvas class="site-spatial-canvas site-spatial-canvas--webgl" id="spatial-webgl" data-spatial-webgl aria-hidden="true"></canvas>
        <canvas class="site-spatial-canvas site-spatial-canvas--canvas" id="spatial-canvas" data-spatial-canvas aria-hidden="true"></canvas>
        <pre class="site-spatial-ascii" data-spatial-output aria-hidden="true"></pre>
    </div>
    <div class="site-backdrop-blur" id="site-backdrop-blur" aria-hidden="true"></div>
${renderNavigation(activePage)}
${body}
${renderFooter()}
${renderFeedMeDialog()}
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
