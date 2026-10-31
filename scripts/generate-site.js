'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadSiteData } = require('./load-site-data');
const { createCveView, compareCvesDescending } = require('./cve-view');
const {
    renderDocument
} = require('./site-shell');
const {
    SITE_ORIGIN,
    clampText,
    escapeHtml,
    formatIsoDate
} = require('./render-utils');
const { verifyBuild } = require('./verify-build');
const { renderPostContent } = require('./render-content');

const projectRoot = path.resolve(__dirname, '..');
const defaultDistRoot = path.join(projectRoot, 'dist');
const STATIC_MOBIUS_FRAME = [
    '                               @@',
    '                          @@@@@@@@@@@@@',
    '                       #@@@@@@@@@@@@@@@#@ #',
    '                      #@@@@@@@@@@@@@@@######',
    '                     #@@@@@@@@@@@@######## ##',
    '                   #@@@@@@@@@@################',
    '                  *#=:          #*************#',
    '                 =+::.             *************',
    '                 -..                +++++********',
    '                .                    ==++++******',
    '                                      ==+++++*****'
].join('\n');

function parseArgs(argv) {
    let distRoot = defaultDistRoot;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--dir' || argument === '--out') {
            const value = argv[index + 1];
            if (!value) throw new Error(`${argument} requires a directory path.`);
            distRoot = path.resolve(value);
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    return { distRoot };
}

async function copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

function renderCveDetailContent(cve, { isTemplate = false, includeRawJson = true, headingLevel = 2 } = {}) {
    const {
        id,
        title,
        description,
        state,
        severity,
        score,
        vector,
        cvssVersion,
        cwes,
        affected,
        references,
        guidance,
        finders,
        assigner,
        datePublished,
        rawRecord
    } = cve;

    const formattedDate = formatIsoDate(datePublished)
        || (state === 'PUBLISHED' ? 'Recorded' : 'Pending');
    const headingTag = headingLevel === 1 ? 'h1' : 'h2';
    const scoreVal = score !== null ? score.toFixed(1) : 'N/A';
    const meterPercent = score !== null ? Math.min(100, Math.max(0, score * 10)) : 0;

    return `
<article class="cve-detail-article cve-detail" aria-labelledby="detail-title-${escapeHtml(id)}" data-cve-detail-record data-cve-id="${escapeHtml(id)}" data-cve-placeholder="${String(cve.isPlaceholder)}">
    <header class="cve-detail-header">
        <div class="cve-detail-topbar">
            <a href="/cves/" class="cve-back-btn" data-cve-back-btn data-cve-detail-close aria-label="Back to all CVEs">
                ← ALL CVES
            </a>
            <div class="cve-header-badges">
                <span class="cve-tag tag-severity severity-badge" data-severity="${escapeHtml(severity.toLowerCase())}">
                    ${escapeHtml(severity)}${score !== null ? ` ${scoreVal}` : ''}
                </span>
                ${state === 'RESERVED' ? `<span class="cve-tag tag-status status-badge status-reserved" data-status="reserved" data-cve-detail-state>RESERVED</span>` : `<span class="cve-tag tag-status status-badge status-published" data-status="published" data-cve-detail-state hidden></span>`}
            </div>
        </div>
        <div class="cve-detail-title-wrap">
            <${headingTag} id="detail-title-${escapeHtml(id)}" class="cve-detail-title cve-id cve-detail__title">${escapeHtml(id)}</${headingTag}>
            <p class="cve-detail-subtitle cve-title cve-detail__subtitle" data-cve-detail-title>${escapeHtml(title)}</p>
        </div>
        <div class="cve-meta-tags cve-meta">
            <span class="cve-tag tag-date">Date: ${formattedDate}</span>
            <span class="cve-tag tag-assigner">Assigner: ${escapeHtml(assigner || 'MITRE / CNA')}</span>
            ${cvssVersion ? `<span class="cve-tag tag-cvss">CVSS ${escapeHtml(cvssVersion)}</span>` : ''}
        </div>
    </header>

    <div class="cve-detail-body cve-detail__body">
        <!-- 1. Target Scope Box -->
        ${affected.length && affected[0].product ? `
        <div class="detail-box cve-target-box">
            <div class="box-title">Target Scope</div>
            <div class="box-content">
                <strong class="target-scope-name">${escapeHtml(affected[0].product)}</strong>
                ${affected[0].vendor && affected[0].vendor !== 'Unknown' ? `<span class="target-scope-vendor">(${escapeHtml(affected[0].vendor)})</span>` : ''}
            </div>
        </div>` : ''}

        <!-- 2. Description Box -->
        <div class="detail-box cve-desc-box">
            <div class="box-title">Description</div>
            <div class="box-content">
                <p class="cve-description" data-cve-detail-description>${escapeHtml(description)}</p>
            </div>
        </div>

        <!-- 3. Metrics & Weakness Row (Side by side on desktop) -->
        <div class="detail-row cve-metrics-row">
            ${score !== null || vector ? `
            <div class="detail-box flex-1 cve-metrics-box">
                <div class="box-title">Metrics (CVSS ${escapeHtml(cvssVersion || '3.1')})</div>
                <div class="box-content">
                    <div class="cvss-meter-wrap">
                        <div class="cvss-meter-header">
                            <span class="cvss-score-val severity-${escapeHtml(severity.toLowerCase())}">${scoreVal}</span>
                            <span class="cvss-severity-label severity-${escapeHtml(severity.toLowerCase())}">${escapeHtml(severity)}</span>
                        </div>
                        <div class="cvss-meter-bar">
                            <div class="cvss-meter-fill severity-bg-${escapeHtml(severity.toLowerCase())}" style="width: ${meterPercent}%;"></div>
                        </div>
                    </div>
                    ${vector ? `
                    <div class="cvss-vector-wrap">
                        <span class="vector-label">Vector:</span>
                        <code class="cve-vector">${escapeHtml(vector)}</code>
                        <button type="button" class="copy-vector-btn copy-vector" data-copy-vector="${escapeHtml(vector)}" title="Copy CVSS Vector" aria-label="Copy CVSS Vector">Copy</button>
                    </div>` : ''}
                </div>
            </div>` : ''}

            ${cwes.length ? `
            <div class="detail-box flex-1 cve-weakness-box">
                <div class="box-title">Weakness (CWE)</div>
                <div class="box-content">
                    <div class="cwe-tags-wrap">
                        ${cwes.map(cwe => `<span class="cwe-badge"><code>${escapeHtml(cwe)}</code></span>`).join('')}
                    </div>
                </div>
            </div>` : ''}
        </div>

        <!-- 4. Affected Software Box -->
        ${affected.length ? `
        <div class="detail-box cve-affected-box">
            <div class="box-title">Affected Software & Versions</div>
            <div class="box-content">
                <ul class="affected-list cve-references cve-affected-list">
                    ${affected.map(item => `
                        <li>
                            <strong class="vendor-name">${escapeHtml(item.product)}</strong>
                            ${item.vendor && item.vendor !== 'Unknown' ? `<span>(${escapeHtml(item.vendor)})</span>` : ''}
                            ${item.versions && item.versions.length ? ` — <code class="version-badge">${item.versions.map(escapeHtml).join(', ')}</code>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>` : ''}

        <!-- 5. Remediation / Solution Box -->
        ${guidance.length ? `
        <div class="detail-box cve-solution-box">
            <div class="box-title">Solution & Remediation</div>
            <div class="box-content">
                ${guidance.map(g => `<p class="cve-solution">${escapeHtml(g)}</p>`).join('')}
            </div>
        </div>` : ''}

        <!-- 6. Discovered By Box -->
        <div class="detail-box cve-finders-box">
            <div class="box-title">Discovered By</div>
            <div class="box-content">
                <div class="finders-grid">
                    ${finders.map(f => `
                        <div class="finder-card">
                            <div class="finder-card-details">
                                <strong class="finder-name">${escapeHtml(f)}</strong>
                                <span class="finder-role">Security Researcher at V1T</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <!-- 7. References Box -->
        <div class="detail-box cve-references-box">
            <div class="box-title">References & Verification</div>
            <div class="box-content">
                <ul class="ref-list cve-references">
                    ${references.map(ref => `
                        <li>
                            <a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.label || ref.url)}</a>
                            ${ref.tags && ref.tags.length ? `<span class="tag cve-reference-tags">${ref.tags.map(escapeHtml).join(', ')}</span>` : ''}
                        </li>
                    `).join('')}
                    <li>
                        <a href="https://www.cve.org/CVERecord?id=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Official Record on CVE.org</a>
                    </li>
                </ul>
                ${cve.isPlaceholder ? '<p class="cve-hydration-status" data-cve-hydration-status aria-live="polite">Cached publication details are pending. The archive can check MITRE when this record is opened.</p>' : ''}
            </div>
        </div>

        <!-- 8. Raw Advisory JSON with Copy Button -->
        ${rawRecord ? `
        <div class="detail-box cve-raw-json">
            <div class="raw-header">
                <span class="raw-title">Raw Advisory JSON Data</span>
                <button type="button" class="copy-json-btn copy-json" data-copy-json>Copy JSON</button>
            </div>
            <pre><code data-raw-json>${escapeHtml(JSON.stringify(rawRecord, null, 2))}</code></pre>
        </div>` : ''}
    </div>
</article>`;
}

function renderHomePage(siteData, cves) {
    const { profile } = siteData;
    const publishedCount = cves.filter(c => c.state === 'PUBLISHED').length;
    const pendingCount = cves.length - publishedCount;
    const recentCves = cves.slice(0, 8);
    const latestPosts = siteData.publishedPosts.slice(0, 3);
    const profileSummary = profile.bio
        || 'A personal archive of security discoveries, vulnerabilities, and the stories behind them.';

    const structuredData = [
        {
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            '@id': `${SITE_ORIGIN}/#profile`,
            url: `${SITE_ORIGIN}/`,
            name: `${profile.displayName || 'Jaze'} — Security Researcher`,
            isPartOf: {
                '@type': 'WebSite',
                name: 'Jaze Security Research',
                url: `${SITE_ORIGIN}/`
            },
            mainEntity: {
                '@context': 'https://schema.org',
                '@type': 'Person',
                '@id': `${SITE_ORIGIN}/#person`,
                name: profile.displayName || 'Jaze',
                jobTitle: profile.headline || 'A Security Researcher From V1T',
                url: `${SITE_ORIGIN}/`,
                image: `${SITE_ORIGIN}${profile.avatar || '/assets/images/jaze_v1t.png'}`,
                affiliation: {
                    '@type': 'Organization',
                    name: 'V1T',
                    url: 'https://v1t.site/#organization'
                },
                sameAs: profile.socials.map(soc => soc.url)
            }
        }
    ];

    const body = `
    <!-- Persistent Center Star Anchor (Invariant Micro Star & Perspective Switcher) -->
    <button class="singularity-star" id="singularity-star" type="button" aria-label="Toggle 3D perspective: Interior / Exterior" title="Toggle 3D perspective: Interior / Exterior">
        <span class="singularity-star__core"></span>
        <span class="singularity-star__aura"></span>
        <span class="singularity-star__tooltip" aria-hidden="true">Toggle 3D View</span>
    </button>

    <!-- Minimalist Intro Loader (Countdown only) -->
    <div class="intro-loader" id="intro-loader" aria-live="polite">
        <span class="intro-loader__clock" data-loader-clock aria-hidden="true">00:03.00</span>
    </div>

    <main class="page-main site-shell home-page" id="main-content">
        <!-- Hero Section -->
        <section class="home-hero" aria-labelledby="hero-title">
            <div class="home-hero__content">
                <div class="hero-kicker">
                    <span class="hero-role">${escapeHtml(profile.headline || 'A Security Researcher From V1T')}</span>
                </div>

                <div class="jaze-logo-stage" aria-label="JAZE">
                    <h1 id="hero-title" class="hero-title jaze-logo-line--main" translate="no">JAZE</h1>
                </div>

                <p class="hero-bio">${escapeHtml(profileSummary)}</p>

                <div class="hero-actions">
                    <a class="hero-link hero-link--primary" href="/cves/">
                        <span>CVE list</span>
                        <span class="hero-link__count">(${cves.length})</span>
                    </a>
                    <a class="hero-link" href="/blog/">Blogs</a>
                    ${profile.socials.map(soc => `
                        <a class="hero-link hero-link--ghost" href="${escapeHtml(soc.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(soc.label)}</a>
                    `).join('')}
                    <a class="hero-link hero-link--ghost" href="https://v1t.site/" rel="external">V1T</a>
                </div>
            </div>
        </section>

        <!-- Researcher Stats & Social Links Strip (Zero-slop minimalist technical metrics) -->
        <section aria-label="Research statistics and social links">
            <div class="stats-strip">
                <a href="/cves/" class="stats-item stats-item--link">
                    <span class="stats-item__val stats-item__val--accent">${cves.length}</span>
                    <span class="stats-item__label">TOTAL CVES</span>
                </a>
                <a href="https://github.com/trijaze" target="_blank" rel="noopener noreferrer" class="stats-item stats-item--link">
                    <span class="stats-item__val">GITHUB</span>
                    <span class="stats-item__label">trijaze</span>
                </a>
                <a href="https://www.linkedin.com/in/trijaze" target="_blank" rel="noopener noreferrer" class="stats-item stats-item--link">
                    <span class="stats-item__val">LINKEDIN</span>
                    <span class="stats-item__label">trijaze</span>
                </a>
                <a href="https://www.google.com/search?q=who+is+jaze+in+cyber+security" target="_blank" rel="noopener noreferrer" class="stats-item stats-item--link">
                    <span class="stats-item__val stats-item__val--whoami">whoami</span>
                    <span class="stats-item__label">VERIFY</span>
                </a>
            </div>
        </section>

        <!-- Auto Slide Show CVE Ticker (All CVEs, horizontal desktop / vertical mobile) -->
        <section aria-labelledby="recent-cves-title" data-cve-home-section class="home-cve-ticker-section">
            <div class="section-header-compact">
                <h2 id="recent-cves-title">Disclosures</h2>
                <a class="view-all" href="/cves/">View all ${cves.length} CVEs</a>
            </div>

            <div class="home-cve-ticker-viewport" id="home-cve-ticker-viewport" tabindex="0" role="region" aria-label="Auto-scrolling CVE list">
                <div class="home-cve-ticker-track" id="home-cve-ticker-track">
                    <div class="home-cve-ticker-group">
                        ${cves.map(c => `
                            <a class="cve-card severity-${escapeHtml(c.severity.toLowerCase())}"
                               href="/cves/?cve=${escapeHtml(c.id)}"
                               data-cve-card
                               data-cve-id="${escapeHtml(c.id)}"
                               data-title="${escapeHtml(c.title)}"
                               data-severity="${escapeHtml(c.severity.toLowerCase())}"
                               data-score="${escapeHtml(String(c.score !== null ? c.score : ''))}"
                               data-state="${escapeHtml(c.state.toLowerCase())}"
                               data-cwes="${escapeHtml(c.cwes.join('|').toLowerCase())}"
                               data-desc="${escapeHtml(c.description || '')}"
                               aria-label="View details for ${escapeHtml(c.id)}">
                                <span class="cve-id">${escapeHtml(c.id)}</span>
                            </a>
                        `).join('')}
                    </div>
                    <div class="home-cve-ticker-group" aria-hidden="true">
                        ${cves.map(c => `
                            <a class="cve-card severity-${escapeHtml(c.severity.toLowerCase())}"
                               href="/cves/?cve=${escapeHtml(c.id)}"
                               data-cve-card
                               data-cve-id="${escapeHtml(c.id)}"
                               data-title="${escapeHtml(c.title)}"
                               data-severity="${escapeHtml(c.severity.toLowerCase())}"
                               data-score="${escapeHtml(String(c.score !== null ? c.score : ''))}"
                               data-state="${escapeHtml(c.state.toLowerCase())}"
                               data-cwes="${escapeHtml(c.cwes.join('|').toLowerCase())}"
                               data-desc="${escapeHtml(c.description || '')}"
                               tabindex="-1"
                               aria-hidden="true">
                                <span class="cve-id">${escapeHtml(c.id)}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            </div>
        </section>

        <section aria-labelledby="latest-posts-title">
            <div class="section-header-compact">
                <h2 id="latest-posts-title">Latest Research Notes</h2>
                <a class="view-all" href="/blog/">View all notes</a>
            </div>
            ${latestPosts.length ? `
                <div class="home-post-list">
                    ${latestPosts.map(post => `
                        <a class="home-post-row" href="/blog/${escapeHtml(post.slug)}/">
                            <span>${escapeHtml(post.title)}</span>
                            <span class="reading-time">${post.readingMinutes} min read</span>
                        </a>
                    `).join('')}
                </div>
            ` : '<p class="home-empty-note">No research notes have been published yet. The CVE archive remains available.</p>'}
        </section>
    </main>`;

    return renderDocument({
        title: 'Jaze — Security Researcher · V1T',
        description: 'Security research profile, verified CVE disclosures, and vulnerability publications for Jaze at V1T.',
        pathname: '/',
        activePage: 'profile',
        body,
        styles: ['cves.css', 'home.css', 'intro-loader.css'],
        scripts: ['ascii-webgl-renderer.js', 'intro-loader.js', 'cve-explorer.js'],
        structuredData
    });
}

function renderCvesArchivePage(siteData, cves) {
    const years = [...new Set(cves.map(c => /^CVE-(\d{4})-/i.exec(c.id)?.[1]).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a, 'en'));
    const cveCardsHtml = cves.map(c => {
        const dateValue = c.datePublished || c.dateReserved || '';
        const scoreValue = c.score !== null ? c.score : '';
        const formattedDate = formatIsoDate(c.datePublished)
            || (c.state === 'PUBLISHED' ? 'Recorded' : 'Pending');

        return `
        <li data-cve-item>
            <a class="cve-card severity-${escapeHtml(c.severity.toLowerCase())}" href="/cves/${escapeHtml(c.id)}/"
               data-cve-card
               data-cve-id="${escapeHtml(c.id)}"
               data-year="${escapeHtml(/^CVE-(\d{4})-/i.exec(c.id)?.[1] || '')}"
               data-title="${escapeHtml(c.title)}"
               data-date="${escapeHtml(dateValue)}"
               data-score="${escapeHtml(String(scoreValue))}"
               data-severity="${escapeHtml(c.severity.toLowerCase())}"
               data-state="${escapeHtml(c.state.toLowerCase())}"
               data-placeholder="${String(c.isPlaceholder)}"
               data-cwes="${escapeHtml(c.cwes.join('|').toLowerCase())}"
               data-desc="${escapeHtml(c.description || '')}"
               data-finders="${escapeHtml(c.finders.join(',').toLowerCase())}"
               aria-controls="cve-detail-view"
               aria-expanded="false"
               aria-label="View details for ${escapeHtml(c.id)}">
                <span class="cve-id">${escapeHtml(c.id)}</span>
            </a>
        </li>`;
    }).join('\n');

    const firstCve = cves[0];
    const initialDetailHtml = firstCve
        ? renderCveDetailContent(firstCve, { isTemplate: false, includeRawJson: true })
        : '<p>No CVE records available.</p>';

    const cveTemplatesHtml = cves.map(c => `
    <template data-cve-detail-template data-cve-id="${escapeHtml(c.id)}">
        ${renderCveDetailContent(c, { isTemplate: true, includeRawJson: true })}
    </template>`).join('\n');

    const structuredData = [
        {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            '@id': `${SITE_ORIGIN}/cves/#collection`,
            url: `${SITE_ORIGIN}/cves/`,
            name: 'CVE Archive — Jaze',
            description: 'Verified CVE disclosures credited to security researcher Jaze.',
            mainEntity: {
                '@type': 'ItemList',
                itemListElement: cves.map((c, index) => ({
                    '@type': 'ListItem',
                    position: index + 1,
                    url: `${SITE_ORIGIN}/cves/${c.id}/`,
                    name: c.id
                }))
            }
        }
    ];

    const body = `
    <main class="page-main site-shell cve-page cve-explorer" id="main-content" data-cve-explorer>
        <header class="cve-header">
            <div class="cve-title-row">
                <h1 id="page-title">CVE Archive.</h1>
                <span class="cve-count">(<span data-cve-visible-count>${cves.length}</span> / ${cves.length} Advisories)</span>
            </div>
            <p>
                Verified vulnerability advisories credited to Jaze with V1T.
            </p>
        </header>

        <form class="cve-toolbar" role="search" aria-label="Filter vulnerability disclosures">
            <label>
                <span>Search</span>
                <input class="cve-search" name="q" type="search" autocomplete="off" placeholder="Search ID, product, CWE, keyword…" data-cve-search>
            </label>
            <label>
                <span>Severity</span>
                <select class="cve-filter" name="severity" data-cve-severity>
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
            </label>
            <label>
                <span>State</span>
                <select class="cve-filter" name="state" data-cve-state>
                    <option value="all">All States</option>
                    <option value="published">Published</option>
                    <option value="reserved">Reserved / Pending</option>
                </select>
            </label>
            <label>
                <span>Year</span>
                <select class="cve-filter" name="year" data-cve-year>
                    <option value="all">All Years</option>
                    ${years.map(year => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('')}
                </select>
            </label>
            <label>
                <span>Sort</span>
                <select class="cve-filter" name="sort" data-cve-sort>
                    <option value="id-desc">CVE ID (Desc)</option>
                    <option value="id-asc">CVE ID (Asc)</option>
                    <option value="severity">Highest Severity</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                </select>
            </label>
        </form>

        <p id="cve-status" class="visually-hidden" aria-live="polite" data-cve-status>Showing ${cves.length} of ${cves.length} CVE records.</p>

        <div class="cve-modal-container" id="cve-archive-container">
            <div class="cve-modal-content">
                <div class="cve-sidebar" id="cve-sidebar">
                    <ul class="cve-grid cve-list" id="cve-grid" data-cve-list aria-label="CVE disclosures grid">
                        ${cveCardsHtml}
                    </ul>
                </div>

                <div class="cve-detail-view cve-detail-pane" id="cve-detail-view" data-cve-detail aria-label="Vulnerability details inspection pane" hidden>
                    ${initialDetailHtml}
                </div>
            </div>
        </div>

        <div class="route-placeholder cve-empty" data-cve-empty hidden>
            <p class="section-kicker">No matching records</p>
            <h2>No CVEs found.</h2>
            <p>Try resetting severity or status filters.</p>
        </div>

        ${cveTemplatesHtml}
    </main>`;

    return renderDocument({
        title: 'CVE Archive — Jaze',
        description: 'Verified Common Vulnerabilities and Exposures credited to security researcher Jaze.',
        pathname: '/cves/',
        activePage: 'cves',
        body,
        styles: ['cves.css'],
        scripts: ['data-client.js', 'cve-explorer.js'],
        structuredData
    });
}

function renderCveDetailPage(cve) {
    const detailContent = renderCveDetailContent(cve, {
        isTemplate: false,
        includeRawJson: true,
        headingLevel: 1
    });

    const structuredData = [
        {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            '@id': `${SITE_ORIGIN}/cves/${cve.id}/#article`,
            url: `${SITE_ORIGIN}/cves/${cve.id}/`,
            headline: `${cve.id} — ${cve.title}`,
            description: cve.description,
            datePublished: cve.datePublished || '2026-10-24',
            dateModified: cve.dateUpdated || cve.datePublished || '2026-10-24',
            author: {
                '@type': 'Person',
                name: 'Jaze',
                url: `${SITE_ORIGIN}/`
            }
        },
        {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
                { '@type': 'ListItem', position: 2, name: 'CVE Archive', item: `${SITE_ORIGIN}/cves/` },
                { '@type': 'ListItem', position: 3, name: cve.id, item: `${SITE_ORIGIN}/cves/${cve.id}/` }
            ]
        }
    ];

    const body = `
    <main class="page-main site-shell" id="main-content">
        <nav class="cve-breadcrumb" aria-label="Breadcrumb">
            <ol class="tag-list">
                <li><a href="/">Home</a> <span aria-hidden="true">/</span></li>
                <li><a href="/cves/">CVE Archive</a> <span aria-hidden="true">/</span></li>
                <li aria-current="page">${escapeHtml(cve.id)}</li>
            </ol>
        </nav>
        ${detailContent}
        <div class="cve-archive-back">
            <a class="hero-link" href="/cves/">Back to CVE Archive</a>
        </div>
    </main>`;

    return renderDocument({
        title: `${cve.id} — Jaze Security Advisory`,
        description: clampText(`${cve.id}: ${cve.description}`, 160),
        pathname: `/cves/${cve.id}/`,
        activePage: 'cves',
        body,
        styles: ['cves.css'],
        scripts: ['cve-detail.js'],
        structuredData
    });
}

function renderBlogArchivePage(siteData) {
    const posts = [...siteData.publishedPosts].sort((a, b) =>
        String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.title.localeCompare(b.title, 'en')
    );
    const tags = [...new Set(posts.flatMap(post => post.tags))].sort((a, b) => a.localeCompare(b, 'en'));
    const structuredData = [
        {
            '@context': 'https://schema.org',
            '@type': 'Blog',
            '@id': `${SITE_ORIGIN}/blog/#blog`,
            url: `${SITE_ORIGIN}/blog/`,
            name: 'Research Blog — Jaze',
            description: 'Security research publications and technical writeups by Jaze.'
        }
    ];

    const body = `
    <main class="page-main site-shell blog-page" id="main-content">
        <header class="blog-header archive-header">
            <h1 id="page-title">Research Notes.</h1>
            <p>Technical writeups, vulnerability discovery methodologies, and proof-of-concept walkthroughs.</p>
        </header>

        <section class="blog-archive" aria-label="Research note archive" data-blog-archive>
        <form class="cve-toolbar blog-toolbar" role="search" aria-label="Filter blog notes">
            <div class="field toolbar-field">
                <label for="blog-search">Search</label>
                <input class="blog-search" id="blog-search" name="q" type="search" autocomplete="off" placeholder="Search notes by keyword or topic…" data-blog-search>
            </div>
            <div class="field toolbar-field">
                <label for="blog-tag">Topic</label>
                <select class="blog-sort" id="blog-tag" name="tag" data-blog-tag>
                    <option value="all">All Topics</option>
                    ${tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('')}
                </select>
            </div>
            <div class="field toolbar-field">
                <label for="blog-sort">Sort</label>
                <select class="blog-sort" id="blog-sort" name="sort" data-blog-sort>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                </select>
            </div>
            <div class="blog-toolbar__summary">
                <span class="visible-count"><span data-blog-visible-count>0</span> notes</span>
                <span id="blog-status" class="visually-hidden" aria-live="polite" data-blog-status></span>
            </div>
        </form>

        <div class="blog-grid" data-blog-list>
            ${posts.map(post => `
                <article class="post-card${post.featured ? ' post-card--featured' : ''}" data-blog-item
                    data-title="${escapeHtml(post.title)}"
                    data-excerpt="${escapeHtml(post.excerpt)}"
                    data-date="${escapeHtml(post.publishedAt)}"
                    data-tags="${escapeHtml(post.tags.join('|'))}">
                    <div class="post-card__meta">
                        <span>${post.readingMinutes} min read</span>
                        ${post.featured ? '<span>Featured</span>' : ''}
                    </div>
                    <h2 class="post-card__title"><a href="/blog/${escapeHtml(post.slug)}/">${escapeHtml(post.title)}</a></h2>
                    <p class="post-card__excerpt">${escapeHtml(post.excerpt)}</p>
                    <div class="post-card__footer">
                        <ul class="tag-list" aria-label="Topics">${post.tags.map(tag => `<li class="tag">${escapeHtml(tag)}</li>`).join('')}</ul>
                        <a href="/blog/${escapeHtml(post.slug)}/" aria-label="Read ${escapeHtml(post.title)}">Read note</a>
                    </div>
                </article>
            `).join('')}
        </div>

        <div class="route-placeholder blog-empty" data-blog-empty${posts.length ? ' hidden' : ''}>
            <h2>No notes published yet.</h2>
            <p>Technical writeups and disclosure case studies will be posted here.</p>
            <a class="hero-link" href="/feed.xml">RSS Feed</a>
        </div>
        </section>
    </main>`;

    return renderDocument({
        title: 'Research Blog — Jaze',
        description: 'Security research publications, technical analysis, and vulnerability writeups by Jaze.',
        pathname: '/blog/',
        activePage: 'blog',
        body,
        styles: ['blog.css'],
        scripts: ['blog.js'],
        structuredData
    });
}

function renderBlogDetailPage(siteData, post, previousPost, nextPost) {
    const document = siteData.postDocuments.get(post.slug);
    const rendered = renderPostContent(document);
    const pathname = `/blog/${post.slug}/`;
    const structuredData = [
        {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            '@id': `${SITE_ORIGIN}${pathname}#article`,
            url: `${SITE_ORIGIN}${pathname}`,
            headline: post.title,
            description: post.excerpt,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt || post.publishedAt,
            author: { '@type': 'Person', name: siteData.profile.displayName, url: `${SITE_ORIGIN}/` },
            publisher: { '@type': 'Person', name: siteData.profile.displayName, url: `${SITE_ORIGIN}/` },
            keywords: post.tags.join(', '),
            mainEntityOfPage: `${SITE_ORIGIN}${pathname}`
        },
        {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
                { '@type': 'ListItem', position: 2, name: 'Research Notes', item: `${SITE_ORIGIN}/blog/` },
                { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE_ORIGIN}${pathname}` }
            ]
        }
    ];
    const toc = rendered.toc.length
        ? `<nav class="post-toc" aria-label="On this page"><strong>On this page</strong><ul>${rendered.toc.map(item => `<li data-level="${item.level}"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`).join('')}</ul></nav>`
        : '<aside class="post-toc"><strong>Research note</strong><p>No section index for this short note.</p></aside>';
    const navigation = [
        previousPost ? `<a href="/blog/${escapeHtml(previousPost.slug)}/">${escapeHtml(previousPost.title)}</a>` : '<span></span>',
        nextPost ? `<a href="/blog/${escapeHtml(nextPost.slug)}/">${escapeHtml(nextPost.title)}</a>` : '<span></span>'
    ].join('');
    const body = `
    <main class="page-main site-shell post-page" id="main-content">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog/">Research Notes</a></nav>
        <header class="post-header">
            <p class="section-kicker">Research note</p>
            <h1>${escapeHtml(post.title)}</h1>
            <p class="post-deck">${escapeHtml(post.excerpt)}</p>
            <div class="post-meta">
                <span>${post.readingMinutes} min read</span>
            </div>
            <ul class="tag-list" aria-label="Topics">${post.tags.map(tag => `<li class="tag">${escapeHtml(tag)}</li>`).join('')}</ul>
        </header>
        <div class="post-layout">
            ${toc}
            <article class="post-prose">${rendered.html}</article>
        </div>
        <nav class="post-navigation" aria-label="Adjacent research notes">${navigation}</nav>
    </main>`;

    return renderDocument({
        title: `${post.title} — Jaze`,
        description: clampText(post.excerpt, 160),
        pathname,
        activePage: 'blog',
        body,
        styles: ['blog.css'],
        scripts: ['article.js'],
        pageType: 'article',
        structuredData
    });
}

function renderNotFoundPage() {
    const body = `
    <main class="page-main site-shell" id="main-content">
        <section class="route-placeholder not-found" aria-labelledby="page-title">
            <p class="section-kicker">404 Error</p>
            <h1 id="page-title">Page not found<span aria-hidden="true">_</span></h1>
            <p>The requested page does not exist in this archive.</p>
            <div class="not-found__actions">
                <a class="hero-link hero-link--primary" href="/">Home</a>
                <a class="hero-link" href="/cves/">CVE Archive</a>
                <a class="hero-link" href="/blog/">Research Notes</a>
            </div>
        </section>
    </main>`;

    return renderDocument({
        title: '404 Not Found — Jaze',
        description: 'The requested Jaze research page could not be found.',
        pathname: '/404.html',
        body,
        robots: 'noindex, follow'
    });
}

function renderSitemapXml(cves, posts) {
    const urls = [
        { loc: `${SITE_ORIGIN}/`, lastmod: '2026-10-24' },
        { loc: `${SITE_ORIGIN}/cves/`, lastmod: '2026-10-24' },
        { loc: `${SITE_ORIGIN}/blog/`, lastmod: '2026-10-24' },
        ...posts.map(post => ({
            loc: `${SITE_ORIGIN}/blog/${post.slug}/`,
            lastmod: post.updatedAt || post.publishedAt
        })),
        ...cves.map(c => ({
            loc: `${SITE_ORIGIN}/cves/${c.id}/`,
            lastmod: c.dateUpdated || c.datePublished || '2026-10-24'
        }))
    ];

    const entries = urls.map(u => `    <url>\n        <loc>${escapeHtml(u.loc)}</loc>\n        <lastmod>${escapeHtml(u.lastmod)}</lastmod>\n    </url>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function renderFeedXml(posts) {
    const items = posts.map(post => `
    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${SITE_ORIGIN}/blog/${escapeHtml(post.slug)}/</link>
      <guid isPermaLink="true">${SITE_ORIGIN}/blog/${escapeHtml(post.slug)}/</guid>
      <pubDate>${new Date(`${post.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeHtml(post.excerpt)}</description>
      ${post.tags.map(tag => `<category>${escapeHtml(tag)}</category>`).join('\n      ')}
    </item>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Jaze — Security Research Feed</title>
    <link>${SITE_ORIGIN}/</link>
    <description>Vulnerability research publications, advisories, and technical security analysis by Jaze.</description>
    <language>en-us</language>
    <atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>\n`;
}

function renderRobotsTxt() {
    return `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

async function writePage(distRoot, relativePath, content) {
    const filePath = path.join(distRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
}

async function generateSite(options = {}) {
    const distRoot = path.resolve(options.distRoot || defaultDistRoot);
    const transactionId = `${process.pid}-${Date.now()}`;
    const stagingRoot = `${distRoot}.tmp-${transactionId}`;
    const backupRoot = `${distRoot}.bak-${transactionId}`;
    const siteData = await loadSiteData();
    const cves = siteData.cves.map(createCveView).sort(compareCvesDescending);
    const posts = [...siteData.publishedPosts].sort((a, b) =>
        String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.title.localeCompare(b.title, 'en')
    );
    let hadExistingBuild = false;
    let installed = false;

    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(stagingRoot, { recursive: true });

    try {
        // 1. Copy static assets and root favicon
        await copyDirectory(path.join(projectRoot, 'assets'), path.join(stagingRoot, 'assets'));
        try {
            await fs.copyFile(path.join(projectRoot, 'favicon.ico'), path.join(stagingRoot, 'favicon.ico'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        // 2. Generate index pages
        await writePage(stagingRoot, 'index.html', renderHomePage(siteData, cves));
        await writePage(stagingRoot, path.join('cves', 'index.html'), renderCvesArchivePage(siteData, cves));
        await writePage(stagingRoot, path.join('blog', 'index.html'), renderBlogArchivePage(siteData));
        await writePage(stagingRoot, '404.html', renderNotFoundPage());

        // 3. Generate detail pages
        for (const cve of cves) {
            await writePage(stagingRoot, path.join('cves', cve.id, 'index.html'), renderCveDetailPage(cve));
        }
        for (let index = 0; index < posts.length; index += 1) {
            const post = posts[index];
            await writePage(
                stagingRoot,
                path.join('blog', post.slug, 'index.html'),
                renderBlogDetailPage(siteData, post, posts[index + 1], posts[index - 1])
            );
        }

        // 4. Generate metadata & root files
        await writePage(stagingRoot, 'sitemap.xml', renderSitemapXml(cves, posts));
        await writePage(stagingRoot, 'feed.xml', renderFeedXml(posts));
        await writePage(stagingRoot, 'robots.txt', renderRobotsTxt());
        await writePage(stagingRoot, 'CNAME', 'jaze.v1t.site\n');
        await writePage(stagingRoot, '.nojekyll', '');
        await writePage(stagingRoot, 'build-manifest.json', `${JSON.stringify({
            schemaVersion: 1,
            origin: SITE_ORIGIN,
            routes: {
                static: 4,
                cves: cves.length,
                posts: posts.length
            },
            records: {
                allCves: siteData.allCves.length,
                jazeCves: cves.length,
                publishedPosts: posts.length
            }
        }, null, 2)}\n`);

        // 5. Verify the complete staging tree before replacing the last good build.
        await verifyBuild({ distRoot: stagingRoot });
        try {
            await fs.rename(distRoot, backupRoot);
            hadExistingBuild = true;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await fs.rename(stagingRoot, distRoot);
        installed = true;
        if (hadExistingBuild) await fs.rm(backupRoot, { recursive: true, force: true });
        if (distRoot === defaultDistRoot) {
            await fs.copyFile(path.join(distRoot, 'index.html'), path.join(projectRoot, 'index.html')).catch(() => {});
            await copyDirectory(path.join(distRoot, 'cves'), path.join(projectRoot, 'cves')).catch(() => {});
        }
        return await verifyBuild({ distRoot });
    } catch (error) {
        if (!installed && hadExistingBuild) {
            await fs.rename(backupRoot, distRoot).catch(() => { });
        }
        throw error;
    } finally {
        await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => { });
        if (installed) await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => { });
    }
}

async function main() {
    const { distRoot } = parseArgs(process.argv.slice(2));
    console.log(`Generating Jaze static site in ${distRoot}...`);
    const summary = await generateSite({ distRoot });
    console.log(`Generated ${summary.fileCount} files (${summary.htmlCount} HTML pages) successfully.`);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Build failed:', error);
        process.exit(1);
    });
}

module.exports = Object.freeze({
    generateSite
});
