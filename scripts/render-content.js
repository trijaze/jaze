'use strict';

const { escapeHtml } = require('./render-utils');
const { isSafeContentUrl } = require('./content-contracts');

function renderInlineMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);

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
        case 'paragraph':
            return `<p>${renderInlineMarkdown(block.text)}</p>`;
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
    renderInlineMarkdown,
    renderPostContent,
    slugifyHeading
});
