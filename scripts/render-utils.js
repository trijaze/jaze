'use strict';

const SITE_ORIGIN = 'https://jaze.v1t.site';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeJsonForHtml(value) {
    return JSON.stringify(value, null, 2)
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('&', '\\u0026');
}

function normalizePathname(pathname = '/') {
    const value = String(pathname || '/').trim();
    const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
    if (withLeadingSlash === '/') return '/';
    if (/\/[^/]+\.[a-z0-9]+$/i.test(withLeadingSlash)) return withLeadingSlash;
    return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function absoluteUrl(pathname = '/') {
    return new URL(normalizePathname(pathname), SITE_ORIGIN).href;
}

function safeHttpUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(String(value), SITE_ORIGIN);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

function formatIsoDate(value, locale = 'en-US') {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date);
}

function clampText(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

module.exports = Object.freeze({
    SITE_ORIGIN,
    absoluteUrl,
    clampText,
    escapeHtml,
    escapeJsonForHtml,
    formatIsoDate,
    normalizePathname,
    safeHttpUrl
});
