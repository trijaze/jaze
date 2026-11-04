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
