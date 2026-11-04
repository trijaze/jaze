'use strict';

const { escapeHtml } = require('./render-utils');
const { isSafeContentUrl } = require('./content-contracts');

function formatMathEquation(raw, isAlreadyEscaped = false) {
    if (!raw) return '';
    let str = String(raw).trim();

    // 1. Protect escaped literal underscores and characters
    str = str.replace(/\\_/g, '@@UNDERSCORE@@');
    str = str.replace(/\\text\{([^}]+)\}/g, '$1');
    str = str.replace(/\\(?:mathbf|mathrm|mathit)\{([^}]+)\}/g, '$1');
    str = str.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
    str = str.replace(/\\&(?:amp;)?/g, '&');
    str = str.replace(/\\#/g, '#');
    str = str.replace(/\\%/g, '%');

    // 2. Escape HTML characters safely if not already escaped
    if (!isAlreadyEscaped) {
        str = escapeHtml(str);
    }

    // 3. Modulo expressions (with support for nested braces/superscripts)
    str = str.replace(/\\pmod\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, '(mod $1)');
    str = str.replace(/\\pmod\s+([a-zA-Z0-9^_{}]+)/g, '(mod $1)');
    str = str.replace(/\\bmod\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, 'mod $1');
    str = str.replace(/\\bmod\s+([a-zA-Z0-9^_{}]+)/g, 'mod $1');

    // 4. LaTeX math symbols -> clean unicode
    str = str.replace(/\\(?:oplus|bigoplus)(?![a-zA-Z])/g, '⊕');
    str = str.replace(/\\times(?![a-zA-Z])/g, '×');
    str = str.replace(/\\parallel(?![a-zA-Z])/g, '∥');
    str = str.replace(/\\(?:rightarrow|to)(?![a-zA-Z])/g, '→');
    str = str.replace(/\\leftarrow(?![a-zA-Z])/g, '←');
    str = str.replace(/\\(?:leftrightarrow)(?![a-zA-Z])/g, '↔');
    str = str.replace(/\\(?:le|leq)(?![a-zA-Z])/g, '≤');
    str = str.replace(/\\(?:ge|geq)(?![a-zA-Z])/g, '≥');
    str = str.replace(/\\(?:neq|ne)(?![a-zA-Z])/g, '≠');
    str = str.replace(/\\approx(?![a-zA-Z])/g, '≈');
    str = str.replace(/\\in(?![a-zA-Z])/g, '∈');
    str = str.replace(/\\notin(?![a-zA-Z])/g, '∉');
    str = str.replace(/\\(?:subset|subsetneq)(?![a-zA-Z])/g, '⊂');
    str = str.replace(/\\subseteq(?![a-zA-Z])/g, '⊆');
    str = str.replace(/\\(?:supset|supsetneq)(?![a-zA-Z])/g, '⊃');
    str = str.replace(/\\supseteq(?![a-zA-Z])/g, '⊇');
    str = str.replace(/\\cap(?![a-zA-Z])/g, '∩');
    str = str.replace(/\\cup(?![a-zA-Z])/g, '∪');
    str = str.replace(/\\forall(?![a-zA-Z])/g, '∀');
    str = str.replace(/\\exists(?![a-zA-Z])/g, '∃');
    str = str.replace(/\\infty(?![a-zA-Z])/g, '∞');
    str = str.replace(/\\pm(?![a-zA-Z])/g, '±');
    str = str.replace(/\\mp(?![a-zA-Z])/g, '∓');
    str = str.replace(/\\cdot(?![a-zA-Z])/g, '·');
    str = str.replace(/\\circ(?![a-zA-Z])/g, '∘');
    str = str.replace(/\\equiv(?![a-zA-Z])/g, '≡');
    str = str.replace(/\\(?:dots|ldots|cdots)(?![a-zA-Z])/g, '…');
    str = str.replace(/\\Delta(?![a-zA-Z])/g, 'Δ');
    str = str.replace(/\\gg(?![a-zA-Z])/g, '≫');
    str = str.replace(/\\ll(?![a-zA-Z])/g, '≪');
    str = str.replace(/\\sum(?![a-zA-Z])/g, '∑');
    str = str.replace(/\\prod(?![a-zA-Z])/g, '∏');
    str = str.replace(/\\(?:left|right)(?![a-zA-Z])/g, '');
    str = str.replace(/\\(?:quad|qquad)(?![a-zA-Z])/g, '&emsp;');

    // 5. Subscripts and superscripts
    str = str.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
    str = str.replace(/\b([a-zA-Z])_([a-zA-Z0-9])\b/g, '$1<sub>$2</sub>');
    str = str.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
    str = str.replace(/\b([a-zA-Z0-9]+)\^([a-zA-Z0-9]+)\b/g, '$1<sup>$2</sup>');

    // 6. Restore literal underscores
    str = str.replace(/@@UNDERSCORE@@/g, '_');

    // 7. Clean up any remaining LaTeX backslashes before spaces, punctuation, or commands
    str = str.replace(/\\[ ,;:]/g, ' ');
    str = str.replace(/\\!/g, '');
    str = str.replace(/\\[a-zA-Z]+/g, '');

    return str;
}

function renderInlineMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);

    // Embedded display math ($$...$$)
    escaped = escaped.replace(/\$\$([^\$]+)\$\$/g, (_match, mathInner) => {
        return `<div class="math-block" role="region" aria-label="Mathematical formula"><div class="math-formula">${formatMathEquation(mathInner, true)}</div></div>`;
    });

    // Inline math: $...$ with LaTeX commands, subscripts, or superscripts
    escaped = escaped.replace(/\$((?:[^$`\n]*?(?:\\[a-zA-Z]+|[a-zA-Z0-9]+_[a-zA-Z0-9{}]+|\^[a-zA-Z0-9{}]+))[^$`\n]*?)\$/g, (_match, mathInner) => {
        return `<span class="math-inline">${formatMathEquation(mathInner, true)}</span>`;
    });

    // Task list checkboxes
    escaped = escaped.replace(/^\[ \]\s+/, '<input type="checkbox" disabled aria-hidden="true"> ');
    escaped = escaped.replace(/^\[[xX]\]\s+/, '<input type="checkbox" checked disabled aria-hidden="true"> ');

    // Inline code
    escaped = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Bold (** or __)
    escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

    // Italic (* or _)
    escaped = escaped.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');

    // Strikethrough (~~)
    escaped = escaped.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // Safe Links: [label](url)
    escaped = escaped.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, rawUrl) => {
        const decodedUrl = rawUrl.replace(/&amp;/g, '&');
        if (isSafeContentUrl(decodedUrl, { allowLocal: true, allowFragment: true })) {
            const isLocal = decodedUrl.startsWith('/');
            const targetAttr = isLocal ? '' : ' target="_blank" rel="noopener noreferrer"';
            return `<a href="${escapeHtml(decodedUrl)}"${targetAttr}>${label}</a>`;
        }
        return match;
    });

    return escaped;
}

function slugifyHeading(value, fallback = 'section') {
    const slug = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || fallback;
}

function createHeadingId(text, seen) {
    const base = slugifyHeading(text);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
}

function parseMermaidFlowchart(rawCode) {
    if (!rawCode) return null;
    const lines = rawCode.split('\n').map(l => l.trim()).filter(Boolean);
    const header = lines[0] || '';
    const match = /^(?:flowchart|graph)\s+([A-Z]{2})/i.exec(header);
    if (!match) return null;
    const direction = match[1].toUpperCase();

    const nodes = new Map();
    const edges = [];
    const nodeClasses = new Map();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        if (/^classDef\s+/i.test(line)) continue;

        const classMatch = /^class\s+([A-Za-z0-9_,\s-]+)\s+([A-Za-z0-9_-]+);?$/.exec(line);
        if (classMatch) {
            const targets = classMatch[1].split(',').map(s => s.trim());
            targets.forEach(t => nodeClasses.set(t, classMatch[2].toLowerCase()));
            continue;
        }

        const edgeMatch = /^([A-Za-z0-9_-]+)\s*(?:-->|-.->|==>|---)\s*(?:\|(?:\"([^\"]*)\"|([^|]*))\|)?\s*([A-Za-z0-9_-]+)$/.exec(line);
        if (edgeMatch) {
            const from = edgeMatch[1];
            const label = (edgeMatch[2] !== undefined ? edgeMatch[2] : edgeMatch[3]) || '';
            const to = edgeMatch[4];
            edges.push({ from, to, label: label.trim() });
            continue;
        }

        const nodeMatch = /^([A-Za-z0-9_-]+)\s*(?:\[\"([\s\S]*?)\"\]|\[([\s\S]*?)\]|\(\"([\s\S]*?)\"\)|\(([\s\S]*?)\)|\{\"([\s\S]*?)\"\}|\{([\s\S]*?)\})$/.exec(line);
        if (nodeMatch) {
            const id = nodeMatch[1];
            const rawLabel = nodeMatch[2] ?? nodeMatch[3] ?? nodeMatch[4] ?? nodeMatch[5] ?? nodeMatch[6] ?? nodeMatch[7] ?? id;
            nodes.set(id, { id, rawLabel });
            continue;
        }
    }

    if (nodes.size === 0) return null;
    return { direction, nodes, edges, nodeClasses };
}

function renderMermaidDiagram(code, caption = null) {
    const parsed = parseMermaidFlowchart(code);
    if (!parsed) return null;

    const { direction, nodes, edges, nodeClasses } = parsed;

    const edgeMap = new Map();
    for (const edge of edges) {
        if (!edgeMap.has(edge.from)) edgeMap.set(edge.from, []);
        edgeMap.get(edge.from).push(edge);
    }

    const nodeArray = Array.from(nodes.values());
    const renderedSteps = [];

    nodeArray.forEach(node => {
        const clsName = nodeClasses.get(node.id) || 'normal';
        const labelLines = node.rawLabel.split(/\\n|\n/).map(l => l.trim()).filter(Boolean);
        const title = labelLines[0] || node.id;
        const details = labelLines.slice(1);

        const detailsHtml = details.map(line => {
            if (/^\(.*\)$/.test(line)) {
                return `<div class="flowchart-node__tag">${escapeHtml(line)}</div>`;
            }
            return `<div class="flowchart-node__sub">${escapeHtml(line)}</div>`;
        }).join('');

        renderedSteps.push(`
            <div class="flowchart-step flowchart-tone-${escapeHtml(clsName)}" id="step-${escapeHtml(node.id)}">
                <div class="flowchart-node">
                    <div class="flowchart-node__header">
                        <span class="flowchart-node__indicator" aria-hidden="true"></span>
                        <strong class="flowchart-node__title">${escapeHtml(title)}</strong>
                    </div>
                    ${detailsHtml ? `<div class="flowchart-node__body">${detailsHtml}</div>` : ''}
                </div>
            </div>
        `);

        const outgoing = edgeMap.get(node.id);
        if (outgoing && outgoing.length) {
            outgoing.forEach(edge => {
                const badgeHtml = edge.label ? `<span class="flowchart-connector__badge">${escapeHtml(edge.label)}</span>` : '';
                renderedSteps.push(`
                    <div class="flowchart-connector" aria-hidden="true">
                        <div class="flowchart-connector__track">
                            <span class="flowchart-connector__pulse"></span>
                        </div>
                        ${badgeHtml}
                        <svg class="flowchart-connector__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <polyline points="19 12 12 19 5 12"></polyline>
                        </svg>
                    </div>
                `);
            });
        }
    });

    const captionHtml = caption ? `<figcaption class="flowchart-caption">${escapeHtml(caption)}</figcaption>` : '';

    return `<figure class="flowchart-figure" role="region" aria-label="Flowchart diagram" data-code-block>
        <div class="flowchart-header">
            <div class="flowchart-header__info">
                <svg class="flowchart-header__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                <span class="flowchart-header__label">STATE TRANSITION FLOWCHART</span>
            </div>
            <button class="copy-code" type="button" data-copy-code aria-label="Copy Mermaid diagram source">Copy</button>
        </div>
        <div class="flowchart-canvas flowchart-dir-${direction.toLowerCase()}">
            ${renderedSteps.join('\n')}
        </div>
        ${captionHtml}
        <pre class="visually-hidden"><code class="language-mermaid">${escapeHtml(code)}</code></pre>
    </figure>`;
}

function renderBlock(block, context) {
    switch (block.type) {
        case 'paragraph': {
            const trimmed = block.text.trim();
            if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
                const mathInner = trimmed.slice(2, -2).trim();
                return `<div class="math-block" role="region" aria-label="Mathematical formula"><div class="math-formula">${formatMathEquation(mathInner, false)}</div></div>`;
            }
            return `<p>${renderInlineMarkdown(block.text)}</p>`;
        }
        case 'heading': {
            const id = createHeadingId(block.text, context.headingIds);
            context.toc.push({ id, level: block.level, text: block.text });
            return `<h${block.level} id="${escapeHtml(id)}">${escapeHtml(block.text)}</h${block.level}>`;
        }
        case 'list': {
            const isTaskList = block.items.some(item => /^\[[ xX]\]/.test(item));
            const tag = block.style === 'ordered' ? 'ol' : 'ul';
            const cls = isTaskList ? ' class="task-list"' : '';
            return `<${tag}${cls}>${block.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`;
        }
        case 'code': {
            if (block.language === 'mermaid') {
                const diagram = renderMermaidDiagram(block.code, block.caption);
                if (diagram) return diagram;
            }
            const label = block.filename || block.language;
            const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
            return `<figure class="code-block" data-code-block>
                <div class="code-block__header">
                    <span>${escapeHtml(label)}</span>
                    <button class="copy-code" type="button" data-copy-code>Copy</button>
                </div>
                <pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.code)}</code></pre>
                ${caption}
            </figure>`;
        }
        case 'image': {
            const dimensions = block.width && block.height
                ? ` width="${block.width}" height="${block.height}"`
                : '';
            return `<figure>
                <img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}"${dimensions} loading="lazy" decoding="async">
                ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}
            </figure>`;
        }
        case 'quote': {
            const attribution = block.attribution
                ? `<footer>— ${block.sourceUrl
                    ? `<a href="${escapeHtml(block.sourceUrl)}">${escapeHtml(block.attribution)}</a>`
                    : escapeHtml(block.attribution)}</footer>`
                : '';
            return `<blockquote><p>${renderInlineMarkdown(block.text)}</p>${attribution}</blockquote>`;
        }
        case 'callout':
            return `<aside class="post-callout" data-tone="${escapeHtml(block.tone)}">
                ${block.title ? `<strong>${renderInlineMarkdown(block.title)}</strong>` : ''}
                <p>${renderInlineMarkdown(block.text)}</p>
            </aside>`;
        case 'table': {
            const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
            const alignments = block.alignments || [];
            const ths = block.headers.map((h, i) => {
                const align = alignments[i] ? ` style="text-align: ${alignments[i]};"` : '';
                return `<th scope="col"${align}>${renderInlineMarkdown(h)}</th>`;
            }).join('');
            const trs = block.rows.map(row => {
                const tds = row.map((cell, i) => {
                    const align = alignments[i] ? ` style="text-align: ${alignments[i]};"` : '';
                    return `<td${align}>${renderInlineMarkdown(cell)}</td>`;
                }).join('');
                return `<tr>${tds}</tr>`;
            }).join('\n');
            return `<div class="table-wrap"><table class="post-table">${caption}<thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
        }
        case 'references':
            return `<section class="post-references" aria-labelledby="post-references-title">
                <h2 id="post-references-title">References</h2>
                <ul>${block.items.map(item => `<li><a href="${escapeHtml(item.url)}" rel="noopener noreferrer">${escapeHtml(item.label)}</a></li>`).join('')}</ul>
            </section>`;
        default:
            throw new Error(`Unsupported content block type: ${block.type}`);
    }
}

function renderPostContent(document) {
    const context = { headingIds: new Map(), toc: [] };
    const html = document.content.map(block => renderBlock(block, context)).join('\n');
    return Object.freeze({ html, toc: Object.freeze(context.toc) });
}

module.exports = Object.freeze({
    formatMathEquation,
    renderInlineMarkdown,
    renderPostContent,
    slugifyHeading
});
