'use strict';

const fs = require('fs');
const path = require('path');
const {
    comparePosts,
    normalizePostDocument,
    normalizePostsList,
    validateContentDataset
} = require('./content-contracts');

const DATA_DIR = path.resolve(__dirname, '../assets/data');
const POSTS_DIR = path.join(DATA_DIR, 'posts');
const POST_CONTENT_DIR = path.resolve(__dirname, '../note-jaze/post-content');

const POSTS_CONFIG = [
    {
        filename: '19_xss_in_24_hours.md',
        slug: '19-xss-in-24-hours',
        title: '19 XSS in 24 Hours: Notes on Source Tracing, Sinks, and Framework Blindspots',
        excerpt: 'A 24-hour sprint through the WordPress plugin repository revealed an eerie pattern: modern Gutenberg hydration and React DOM bridges repeatedly fall into the exact same architectural traps.',
        publishedAt: '2026-10-26',
        updatedAt: '2026-10-26',
        tags: ['wordpress', 'xss', 'appsec', 'gutenberg', 'research'],
        readingMinutes: 12,
        featured: true,
        status: 'published'
    },
    {
        filename: 'dxp-toolkit-blog.md',
        slug: 'cve-2026-115607-dxp-toolkit-unauthenticated-sqli',
        title: 'Breaking Down CVE-2026-115607: An Unauthenticated UNION SQLi in WordPress DXP ToolKit',
        excerpt: 'A commented-out authentication check combined with raw string concatenation turned a REST API search parameter into an instant, in-band database dump.',
        publishedAt: '2026-10-28',
        updatedAt: '2026-10-28',
        tags: ['cve', 'sqli', 'rest-api', 'wordpress', 'vulnerability'],
        readingMinutes: 8,
        featured: false,
        status: 'published'
    },
    {
        filename: 'tailored-tools-blog.md',
        slug: 'cve-2026-62025-tailored-tools-unauthenticated-rce',
        title: 'My First Critical: How an Insecure Form Framework Led to Unauthenticated RCE in Tailored Tools',
        excerpt: 'After hitting a string of duplicate reports, a late-night audit of a developer form framework uncovered raw file moves with zero checks — scoring a 9.0 Critical CVE.',
        publishedAt: '2026-10-30',
        updatedAt: '2026-10-30',
        tags: ['cve', 'critical', 'rce', 'file-upload', 'bug-bounty'],
        readingMinutes: 14,
        featured: true,
        status: 'published'
    },
    {
        filename: 'woo-photo-reviews-blog.md',
        slug: 'cve-2026-100517-woo-photo-reviews-arbitrary-post-deletion',
        title: 'The Ghost Delete: How a Flawed Review Parameter Led to Unauthenticated Arbitrary Post Deletion',
        excerpt: 'A look beyond obvious code execution sinks: how trusting client-supplied IDs in WooCommerce photo reviews turned WordPress comment cleanup into an unauthenticated database wipe.',
        publishedAt: '2026-10-31',
        updatedAt: '2026-10-31',
        tags: ['cve', 'idor', 'woocommerce', 'logic-bug', 'availability'],
        readingMinutes: 12,
        featured: false,
        status: 'published'
    }
];

function parseFrontmatter(source) {
    const normalized = source.replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return { frontmatter: {}, body: normalized };
    }

    const endIndex = normalized.indexOf('\n---\n', 4);
    if (endIndex === -1) {
        return { frontmatter: {}, body: normalized };
    }

    const rawYaml = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 5);

    const frontmatter = {};
    const lines = rawYaml.split('\n');
    let currentKey = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Check for list item under currentKey
        if (currentKey && trimmed.startsWith('- ') && (line.startsWith(' ') || line.startsWith('\t') || !line.includes(':'))) {
            const val = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
            if (!Array.isArray(frontmatter[currentKey])) {
                frontmatter[currentKey] = [];
            }
            frontmatter[currentKey].push(val);
            continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const key = line.slice(0, colonIdx).trim();
        let rawVal = line.slice(colonIdx + 1).trim();

        if (rawVal === '') {
            currentKey = key;
            frontmatter[key] = [];
            continue;
        }

        currentKey = key;

        if (rawVal.toLowerCase() === 'true') {
            frontmatter[key] = true;
        } else if (rawVal.toLowerCase() === 'false') {
            frontmatter[key] = false;
        } else if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
            frontmatter[key] = Number(rawVal);
        } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
            const items = rawVal.slice(1, -1).split(',')
                .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean);
            frontmatter[key] = items;
        } else if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
            frontmatter[key] = rawVal.slice(1, -1);
        } else {
            frontmatter[key] = rawVal;
        }
    }

    return { frontmatter, body };
}

function calculateReadingMinutes(text) {
    if (!text || typeof text !== 'string') return 1;
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(wordCount / 200));
}

function isTableDivider(line) {
    if (!line) return false;
    const trimmed = line.trim();
    if (!trimmed.includes('-')) return false;
    const hasPipes = trimmed.startsWith('|') || trimmed.endsWith('|') || trimmed.includes('|');
    if (!hasPipes) return false;

    let s = trimmed;
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = s.split('|').map(c => c.trim());
    if (cells.length === 0) return false;
    return cells.every(c => /^:?-+:?$/.test(c));
}

function parseTableRow(line) {
    let raw = line.trim();
    if (raw.startsWith('|')) raw = raw.slice(1);
    if (raw.endsWith('|')) raw = raw.slice(0, -1);
    const cells = [];
    let current = '';
    for (let c = 0; c < raw.length; c++) {
        if (raw[c] === '\\' && c + 1 < raw.length && raw[c + 1] === '|') {
            current += '|';
            c++;
        } else if (raw[c] === '|') {
            cells.push(current.trim());
            current = '';
        } else {
            current += raw[c];
        }
    }
    cells.push(current.trim());
    return cells;
}

function parseAlignment(dividerCell) {
    const c = (dividerCell || '').trim();
    const starts = c.startsWith(':');
    const ends = c.endsWith(':');
    if (starts && ends) return 'center';
    if (ends) return 'right';
    return 'left';
}

function parseMarkdownToBlocks(markdown) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;

    let inReferencesSection = false;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip blank lines and divider lines
        if (!trimmed || trimmed === '---' || trimmed === '***') {
            i++;
            continue;
        }

        // Fenced code blocks
        if (trimmed.startsWith('```')) {
            const langMatch = trimmed.match(/^```([a-zA-Z0-9_+#.-]*)/);
            let rawLang = langMatch && langMatch[1] ? langMatch[1].toLowerCase() : 'text';
            if (rawLang === 'js') rawLang = 'javascript';
            if (rawLang === 'py') rawLang = 'python';
            if (rawLang === 'sh') rawLang = 'bash';
            if (!rawLang || !/^[a-z0-9+#.-]+$/.test(rawLang)) rawLang = 'text';

            i++;
            const codeLines = [];
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip ending ```

            const fullCode = codeLines.join('\n');
            let filename = null;
            const firstLine = codeLines[0] || '';
            const fileMatch = firstLine.match(/^\/\/\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/)
                || firstLine.match(/^#\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/);
            if (fileMatch) {
                filename = fileMatch[1];
            }

            const codeBlock = {
                type: 'code',
                language: rawLang,
                code: fullCode
            };
            if (filename) codeBlock.filename = filename;
            blocks.push(codeBlock);
            continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const levelCount = headingMatch[1].length;
            const headingText = headingMatch[2].trim().replace(/\*\*|__/g, '');
            
            // Skip top-level # Title as it is rendered in page header
            if (levelCount === 1) {
                i++;
                continue;
            }

            const level = Math.min(Math.max(levelCount, 2), 4);
            if (headingText.toLowerCase().includes('reference') || headingText.toLowerCase().includes('further reading')) {
                inReferencesSection = true;
            } else {
                inReferencesSection = false;
            }

            blocks.push({
                type: 'heading',
                level,
                text: headingText.slice(0, 200)
            });
            i++;
            continue;
        }

        // References section
        if (inReferencesSection && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed))) {
            const refItems = [];
            const seenUrls = new Set();
            while (i < lines.length) {
                const cur = lines[i].trim();
                if (!cur) {
                    i++;
                    continue;
                }
                const linkMatch = cur.match(/\[(.*?)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/);
                if (linkMatch) {
                    const url = linkMatch[2].trim();
                    const label = linkMatch[1].trim().slice(0, 300);
                    if (!seenUrls.has(url.toLowerCase())) {
                        seenUrls.add(url.toLowerCase());
                        refItems.push({ label, url });
                    }
                    i++;
                } else if (cur.startsWith('-') || cur.startsWith('*') || /^\d+\./.test(cur)) {
                    const urlMatch = cur.match(/((?:https?:\/\/|\/)[^\s]+)/);
                    if (urlMatch) {
                        const url = urlMatch[1].trim();
                        const label = cur.replace(/^[-*\d.]+\s*/, '').replace(url, '').replace(/[:()\-]/g, '').trim().slice(0, 300) || url;
                        if (!seenUrls.has(url.toLowerCase())) {
                            seenUrls.add(url.toLowerCase());
                            refItems.push({ label, url });
                        }
                    }
                    i++;
                } else {
                    break;
                }
            }
            if (refItems.length > 0) {
                blocks.push({
                    type: 'references',
                    items: refItems
                });
            }
            continue;
        }

        // Table (GFM pipe syntax)
        if (trimmed.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
            const rawHeaders = parseTableRow(line);
            if (rawHeaders.length > 0) {
                const rawDividers = parseTableRow(lines[i + 1]);
                const alignments = rawDividers.slice(0, rawHeaders.length).map(parseAlignment);
                while (alignments.length < rawHeaders.length) {
                    alignments.push('left');
                }

                i += 2;
                const rows = [];
                while (i < lines.length) {
                    const rowLine = lines[i];
                    const rowTrimmed = rowLine.trim();
                    if (!rowTrimmed || !rowTrimmed.includes('|')) break;
                    if (rowTrimmed.startsWith('```') || rowTrimmed.startsWith('#') || rowTrimmed.startsWith('>')) break;

                    const rowCells = parseTableRow(rowLine);
                    while (rowCells.length < rawHeaders.length) {
                        rowCells.push('');
                    }
                    rows.push(rowCells.slice(0, rawHeaders.length));
                    i++;
                }

                blocks.push({
                    type: 'table',
                    headers: rawHeaders,
                    rows,
                    alignments
                });
                continue;
            }
        }

        // Blockquote or Callout
        if (trimmed.startsWith('>')) {
            const quoteLines = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            const fullQuote = quoteLines.join(' ').trim();

            if (fullQuote.includes('[!NOTE]') || fullQuote.includes('[!INFO]') || fullQuote.toLowerCase().startsWith('note:')) {
                const cleanedText = fullQuote
                    .replace(/\[!(NOTE|INFO)\]/i, '')
                    .replace(/^note:\s*/i, '')
                    .replace(/\*\*note:?\*\*\s*/i, '')
                    .trim();
                blocks.push({
                    type: 'callout',
                    tone: 'note',
                    title: 'Research Note',
                    text: cleanedText.slice(0, 10000)
                });
            } else if (fullQuote.includes('[!WARNING]') || fullQuote.includes('[!CAUTION]') || fullQuote.toLowerCase().startsWith('warning:')) {
                const cleanedText = fullQuote
                    .replace(/\[!(WARNING|CAUTION)\]/i, '')
                    .replace(/^warning:\s*/i, '')
                    .replace(/\*\*warning:?\*\*\s*/i, '')
                    .trim();
                blocks.push({
                    type: 'callout',
                    tone: 'warning',
                    title: 'Warning',
                    text: cleanedText.slice(0, 10000)
                });
            } else if (fullQuote.includes('[!DANGER]') || fullQuote.toLowerCase().startsWith('danger:')) {
                const cleanedText = fullQuote
                    .replace(/\[!DANGER\]/i, '')
                    .replace(/^danger:\s*/i, '')
                    .trim();
                blocks.push({
                    type: 'callout',
                    tone: 'danger',
                    title: 'Critical Risk',
                    text: cleanedText.slice(0, 10000)
                });
            } else {
                let text = fullQuote;
                let attribution = null;
                const attrMatch = fullQuote.match(/^(.*?)\s*—\s*(.*?)$/);
                if (attrMatch) {
                    text = attrMatch[1];
                    attribution = attrMatch[2];
                }
                const quoteBlock = {
                    type: 'quote',
                    text: text.slice(0, 5000)
                };
                if (attribution) quoteBlock.attribution = attribution.slice(0, 300);
                blocks.push(quoteBlock);
            }
            continue;
        }

        // Lists (unordered, ordered, and task lists)
        const isUnordered = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const isOrdered = /^\d+\.\s+/.test(trimmed);

        if (isUnordered || isOrdered) {
            const listStyle = isOrdered ? 'ordered' : 'unordered';
            const rawItems = [];
            while (i < lines.length) {
                const curTrimmed = lines[i].trim();
                if (!curTrimmed) {
                    if (i + 1 < lines.length && (lines[i+1].trim().startsWith('- ') || lines[i+1].trim().startsWith('* ') || /^\d+\.\s+/.test(lines[i+1].trim()))) {
                        i++;
                        continue;
                    }
                    break;
                }

                if (listStyle === 'unordered' && (curTrimmed.startsWith('- ') || curTrimmed.startsWith('* '))) {
                    rawItems.push(curTrimmed.replace(/^[-*]\s+/, '').trim());
                    i++;
                } else if (listStyle === 'ordered' && /^\d+\.\s+/.test(curTrimmed)) {
                    rawItems.push(curTrimmed.replace(/^\d+\.\s+/, '').trim());
                    i++;
                } else if (rawItems.length > 0 && !curTrimmed.startsWith('#') && !curTrimmed.startsWith('```') && !curTrimmed.startsWith('>') && !curTrimmed.includes('|')) {
                    rawItems[rawItems.length - 1] += ' ' + curTrimmed;
                    i++;
                } else {
                    break;
                }
            }

            // Ensure unique items per list (required by normalizeUniqueStringArray)
            const seenItems = new Set();
            const items = [];
            for (let idx = 0; idx < rawItems.length; idx++) {
                let itemText = rawItems[idx].slice(0, 2000);
                let checkKey = itemText.toLowerCase();
                let suffix = 2;
                while (seenItems.has(checkKey)) {
                    itemText = `${itemText} (${suffix++})`;
                    checkKey = itemText.toLowerCase();
                }
                seenItems.add(checkKey);
                items.push(itemText);
            }

            if (items.length > 0) {
                blocks.push({
                    type: 'list',
                    style: listStyle,
                    items
                });
            }
            continue;
        }

        // Paragraph
        const paraLines = [];
        while (i < lines.length) {
            const cur = lines[i];
            const curTrimmed = cur.trim();
            if (!curTrimmed || curTrimmed === '---' || curTrimmed.startsWith('#') || curTrimmed.startsWith('```') || curTrimmed.startsWith('>') || curTrimmed.startsWith('- ') || curTrimmed.startsWith('* ') || /^\d+\.\s+/.test(curTrimmed)) {
                break;
            }
            if (curTrimmed.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
                break;
            }
            paraLines.push(curTrimmed);
            i++;
        }
        if (paraLines.length > 0) {
            const paraText = paraLines.join(' ').slice(0, 10000);
            blocks.push({
                type: 'paragraph',
                text: paraText
            });
        }
    }

    return blocks;
}

function compileAllPosts() {
    console.log('Compiling all posts into Jaze data store...');
    const postDocumentsMap = new Map();
    const postsList = [];

    // Map existing configuration for fast lookup
    const configByFilename = new Map();
    const configBySlug = new Map();
    for (const conf of POSTS_CONFIG) {
        if (conf.filename) configByFilename.set(conf.filename, conf);
        if (conf.slug) configBySlug.set(conf.slug, conf);
    }

    // Read all markdown files in post-content dir if exists
    let mdFiles = [];
    if (fs.existsSync(POST_CONTENT_DIR)) {
        mdFiles = fs.readdirSync(POST_CONTENT_DIR)
            .filter(f => f.endsWith('.md'))
            .sort();
    }

    // Process posts from files
    const processedSlugs = new Set();

    for (const filename of mdFiles) {
        const mdPath = path.join(POST_CONTENT_DIR, filename);
        const rawContent = fs.readFileSync(mdPath, 'utf8');
        const { frontmatter, body } = parseFrontmatter(rawContent);

        const config = configByFilename.get(filename) || {};
        const slug = frontmatter.slug || config.slug || filename.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const title = frontmatter.title || config.title || slug;
        const excerpt = frontmatter.excerpt || config.excerpt || 'Security research note.';
        const publishedAt = frontmatter.publishedAt || config.publishedAt || new Date().toISOString().slice(0, 10);
        const updatedAt = frontmatter.updatedAt || config.updatedAt || publishedAt;
        const tags = frontmatter.tags || config.tags || ['security', 'research'];
        const readingMinutes = frontmatter.readingMinutes || config.readingMinutes || calculateReadingMinutes(body);
        const featured = frontmatter.featured !== undefined ? Boolean(frontmatter.featured) : (config.featured || false);
        const status = frontmatter.status || config.status || 'published';

        if (status === 'draft') {
            console.log(`Skipping draft post (unpublished vulnerability): ${slug} (${filename})`);
            continue;
        }

        let order = null;
        const rawOrder = frontmatter.order !== undefined ? frontmatter.order : config.order;
        if (rawOrder !== undefined && rawOrder !== null) {
            const parsedOrder = Number(rawOrder);
            if (Number.isInteger(parsedOrder) && parsedOrder >= 1 && parsedOrder <= 10000) {
                order = parsedOrder;
            }
        }

        const postEntry = {
            slug,
            title,
            excerpt,
            publishedAt,
            updatedAt,
            tags,
            readingMinutes,
            featured,
            status,
            order
        };

        const blocks = parseMarkdownToBlocks(body);
        const document = { slug, content: blocks };

        // Validate individual document
        normalizePostDocument(document, { expectedSlug: slug });
        postDocumentsMap.set(slug, document);
        postsList.push(postEntry);
        processedSlugs.add(slug);
    }

    // Process any POSTS_CONFIG entries without markdown files (pure JSON entries)
    for (const config of POSTS_CONFIG) {
        if (config.status === 'draft') continue;
        if (processedSlugs.has(config.slug)) continue;
        const { filename, slug, ...meta } = config;
        let order = null;
        if (meta.order !== undefined && meta.order !== null) {
            const parsedOrder = Number(meta.order);
            if (Number.isInteger(parsedOrder) && parsedOrder >= 1 && parsedOrder <= 10000) {
                order = parsedOrder;
            }
        }
        const postEntry = { slug, ...meta, order };

        const existingPath = path.join(POSTS_DIR, `${slug}.json`);
        if (fs.existsSync(existingPath)) {
            const existingData = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
            const document = { slug, content: existingData.content };
            normalizePostDocument(document, { expectedSlug: slug });
            postDocumentsMap.set(slug, document);
            postsList.push(postEntry);
            processedSlugs.add(slug);
        }
    }

    // Sort posts list by order / publication date
    postsList.sort(comparePosts);

    // Validate posts list
    normalizePostsList(postsList);

    // Cross-validate full dataset
    const profilePath = path.join(DATA_DIR, 'profile.json');
    const membersPath = path.join(DATA_DIR, 'members.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));

    validateContentDataset({
        profile,
        postsList,
        postsBySlug: postDocumentsMap,
        members
    });

    console.log('Validation passed for all posts! Writing files to disk...');

    // Write posts-list.json
    const postsListPath = path.join(DATA_DIR, 'posts-list.json');
    fs.writeFileSync(postsListPath, JSON.stringify(postsList, null, 2) + '\n', 'utf8');
    console.log(`Updated ${postsListPath}`);

    // Write individual posts
    for (const [slug, document] of postDocumentsMap.entries()) {
        const postPath = path.join(POSTS_DIR, `${slug}.json`);
        fs.writeFileSync(postPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
        console.log(`Saved ${postPath} (${document.content.length} blocks)`);
    }

    // Clean up any post JSON files that are no longer published
    if (fs.existsSync(POSTS_DIR)) {
        const existingJsonFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.json'));
        for (const file of existingJsonFiles) {
            const fileSlug = file.replace(/\.json$/, '');
            if (!postDocumentsMap.has(fileSlug)) {
                fs.unlinkSync(path.join(POSTS_DIR, file));
                console.log(`Cleaned up unpublished/removed post file: ${file}`);
            }
        }
    }

    console.log(`Successfully compiled ${postsList.length} blog posts!`);
}

module.exports = {
    compileAllPosts,
    parseMarkdownToBlocks,
    parseFrontmatter,
    calculateReadingMinutes
};

if (require.main === module) {
    try {
        compileAllPosts();
    } catch (err) {
        console.error('Compilation failed:', err);
        process.exit(1);
    }
}
