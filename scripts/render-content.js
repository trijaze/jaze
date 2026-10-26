'use strict';

const { escapeHtml } = require('./render-utils');

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
            return `<p>${escapeHtml(block.text)}</p>`;
        case 'heading': {
            const id = createHeadingId(block.text, context.headingIds);
            context.toc.push({ id, level: block.level, text: block.text });
            return `<h${block.level} id="${escapeHtml(id)}">${escapeHtml(block.text)}</h${block.level}>`;
        }
        case 'list': {
            const tag = block.style === 'ordered' ? 'ol' : 'ul';
            return `<${tag}>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
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
            return `<blockquote><p>${escapeHtml(block.text)}</p>${attribution}</blockquote>`;
        }
        case 'callout':
            return `<aside class="post-callout" data-tone="${escapeHtml(block.tone)}">
                ${block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ''}
                <p>${escapeHtml(block.text)}</p>
            </aside>`;
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
    renderPostContent,
    slugifyHeading
});
