'use strict';

const POST_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const CONTENT_BLOCK_TYPES = Object.freeze([
    'paragraph',
    'heading',
    'list',
    'code',
    'image',
    'quote',
    'callout',
    'references'
]);

const POST_STATUS_SET = new Set(POST_STATUSES);
const CONTENT_BLOCK_TYPE_SET = new Set(CONTENT_BLOCK_TYPES);
const LIST_STYLES = new Set(['ordered', 'unordered']);
const CALLOUT_TONES = new Set(['note', 'info', 'success', 'warning', 'danger']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEMBER_ID_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE_PATTERN = /^[a-z0-9][a-z0-9+#._-]*$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ABSOLUTE_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const PROFILE_FIELDS = new Set([
    'memberId',
    'displayName',
    'headline',
    'bio',
    'avatar',
    'focus',
    'socials',
    'availableFor',
    'location'
]);
const SOCIAL_FIELDS = new Set(['label', 'url']);
const POST_INDEX_FIELDS = new Set([
    'slug',
    'title',
    'excerpt',
    'publishedAt',
    'updatedAt',
    'tags',
    'readingMinutes',
    'featured',
    'status'
]);
const POST_DOCUMENT_FIELDS = new Set(['slug', 'content']);

function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, location) {
    if (!isPlainObject(value)) {
        throw new Error(`${location} must be an object.`);
    }
}

function assertAllowedKeys(record, allowedKeys, location) {
    const unknownKeys = Object.keys(record).filter(key => !allowedKeys.has(key));
    if (!unknownKeys.length) return;

    const htmlKeys = unknownKeys.filter(key => key.toLowerCase().includes('html'));
    if (htmlKeys.length) {
        throw new Error(
            `${location} contains raw HTML field(s): ${htmlKeys.join(', ')}. `
            + 'Raw HTML is not allowed; use typed content blocks.'
        );
    }

    throw new Error(`${location} contains unsupported field(s): ${unknownKeys.join(', ')}.`);
}

function assertRequiredKeys(record, requiredKeys, location) {
    const missingKeys = requiredKeys.filter(key => !hasOwn(record, key));
    if (missingKeys.length) {
        throw new Error(`${location} is missing required field(s): ${missingKeys.join(', ')}.`);
    }
}

function normalizeText(value, location, options = {}) {
    const {
        allowEmpty = false,
        maxLength = 500,
        pattern = null
    } = options;

    if (typeof value !== 'string') {
        throw new Error(`${location} must be a string.`);
    }

    const normalized = value.trim();
    if (!allowEmpty && !normalized) {
        throw new Error(`${location} must be a non-empty string.`);
    }
    if (normalized.length > maxLength) {
        throw new Error(`${location} must not exceed ${maxLength} characters.`);
    }
    if (pattern && normalized && !pattern.test(normalized)) {
        throw new Error(`${location} has an invalid format: ${normalized}`);
    }
    return normalized;
}

function normalizeVerbatimText(value, location, options = {}) {
    const { maxLength = 100000 } = options;
    if (typeof value !== 'string') {
        throw new Error(`${location} must be a string.`);
    }
    if (!value.trim()) {
        throw new Error(`${location} must be a non-empty string.`);
    }
    if (value.length > maxLength) {
        throw new Error(`${location} must not exceed ${maxLength} characters.`);
    }
    return value;
}

function normalizeOptionalText(record, field, location, options = {}) {
    if (!hasOwn(record, field) || record[field] === null) return null;
    return normalizeText(record[field], `${location}.${field}`, options);
}

function normalizeUniqueStringArray(value, location, options = {}) {
    const {
        maxItems = 30,
        itemMaxLength = 80,
        pattern = null,
        lowercase = false
    } = options;

    if (!Array.isArray(value)) {
        throw new Error(`${location} must be an array.`);
    }
    if (value.length > maxItems) {
        throw new Error(`${location} must not contain more than ${maxItems} items.`);
    }

    const seen = new Set();
    return value.map((item, index) => {
        let normalized = normalizeText(item, `${location}[${index}]`, {
            maxLength: itemMaxLength,
            pattern
        });
        if (lowercase) normalized = normalized.toLowerCase();

        const identity = normalized.toLocaleLowerCase('en-US');
        if (seen.has(identity)) {
            throw new Error(`${location} contains duplicate value: ${normalized}.`);
        }
        seen.add(identity);
        return normalized;
    });
}

function validateLocalPath(value, location, options = {}) {
    const { allowFragment = false } = options;
    if (value.startsWith('//')) {
        throw new Error(`${location} must not use a protocol-relative URL.`);
    }
    if (value.startsWith('#')) {
        if (allowFragment && /^#[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return;
        throw new Error(`${location} contains an invalid local fragment.`);
    }

    const path = value.split(/[?#]/, 1)[0];
    if (!path || path === '/' || path.startsWith('?')) {
        throw new Error(`${location} must contain a local path.`);
    }

    const segments = path.split('/');
    segments.forEach((segment, index) => {
        if (!segment) return;
        if (segment === '.' && index === 0) return;

        let decoded;
        try {
            decoded = decodeURIComponent(segment);
        } catch {
            throw new Error(`${location} contains invalid URL encoding.`);
        }

        if (
            decoded === '.'
            || decoded === '..'
            || decoded.includes('/')
            || decoded.includes('\\')
            || /[\u0000-\u001f\u007f]/u.test(decoded)
        ) {
            throw new Error(`${location} contains an unsafe local path segment.`);
        }
    });
}

function normalizeSafeUrl(value, location, options = {}) {
    const {
        allowLocal = true,
        allowFragment = false
    } = options;
    const normalized = normalizeText(value, location, { maxLength: 2048 });

    if (/[\u0000-\u0020\u007f\\]/u.test(normalized)) {
        throw new Error(`${location} contains whitespace, a control character, or a backslash.`);
    }

    if (ABSOLUTE_SCHEME_PATTERN.test(normalized)) {
        let parsed;
        try {
            parsed = new URL(normalized);
        } catch {
            throw new Error(`${location} must be a valid HTTP(S) URL or local path.`);
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`${location} only permits HTTP(S) URLs or local paths.`);
        }
        if (!parsed.hostname || parsed.username || parsed.password) {
            throw new Error(`${location} must not omit a host or contain URL credentials.`);
        }
        return normalized;
    }

    if (!allowLocal) {
        throw new Error(`${location} must be an absolute HTTP(S) URL.`);
    }

    validateLocalPath(normalized, location, { allowFragment });
    return normalized;
}

function isSafeContentUrl(value, options = {}) {
    try {
        normalizeSafeUrl(value, 'URL', options);
        return true;
    } catch {
        return false;
    }
}

function normalizeSocials(value, location) {
    if (!Array.isArray(value)) {
        throw new Error(`${location} must be an array.`);
    }
    if (value.length > 20) {
        throw new Error(`${location} must not contain more than 20 links.`);
    }

    const seenLabels = new Set();
    const seenUrls = new Set();
    return value.map((social, index) => {
        const itemLocation = `${location}[${index}]`;
        assertPlainObject(social, itemLocation);
        assertAllowedKeys(social, SOCIAL_FIELDS, itemLocation);
        assertRequiredKeys(social, ['label', 'url'], itemLocation);

        const label = normalizeText(social.label, `${itemLocation}.label`, { maxLength: 50 });
        const url = normalizeSafeUrl(social.url, `${itemLocation}.url`, { allowLocal: false });
        const labelKey = label.toLocaleLowerCase('en-US');
        const urlKey = url.toLocaleLowerCase('en-US');

        if (seenLabels.has(labelKey)) {
            throw new Error(`${location} contains duplicate label: ${label}.`);
        }
        if (seenUrls.has(urlKey)) {
            throw new Error(`${location} contains duplicate URL: ${url}.`);
        }
        seenLabels.add(labelKey);
        seenUrls.add(urlKey);
        return { label, url };
    });
}

function collectKnownMemberIds(members) {
    if (members === undefined) return null;
    if (!Array.isArray(members)) {
        throw new Error('members must be an array when supplied to profile validation.');
    }

    return new Set(members.map((member, index) => {
        const rawId = typeof member === 'string' ? member : member && member.id;
        return normalizeText(rawId, `members[${index}].id`, {
            maxLength: 80,
            pattern: MEMBER_ID_PATTERN
        }).toLowerCase();
    }));
}

function normalizeProfile(rawProfile, options = {}) {
    const location = 'profile.json';
    assertPlainObject(rawProfile, location);
    assertAllowedKeys(rawProfile, PROFILE_FIELDS, location);
    assertRequiredKeys(rawProfile, [...PROFILE_FIELDS], location);

    const memberId = normalizeText(rawProfile.memberId, `${location}.memberId`, {
        maxLength: 80,
        pattern: MEMBER_ID_PATTERN
    }).toLowerCase();
    const knownMemberIds = collectKnownMemberIds(options.members);
    if (knownMemberIds && !knownMemberIds.has(memberId)) {
        throw new Error(`${location}.memberId does not exist in members.json: ${memberId}.`);
    }

    const displayName = normalizeText(rawProfile.displayName, `${location}.displayName`, {
        maxLength: 100
    });
    const headline = normalizeText(rawProfile.headline, `${location}.headline`, {
        maxLength: 160
    });
    const bio = normalizeText(rawProfile.bio, `${location}.bio`, {
        allowEmpty: true,
        maxLength: 2000
    });
    const avatar = normalizeSafeUrl(rawProfile.avatar, `${location}.avatar`);
    const focus = normalizeUniqueStringArray(rawProfile.focus, `${location}.focus`);
    const socials = normalizeSocials(rawProfile.socials, `${location}.socials`);
    const availableFor = normalizeUniqueStringArray(
        rawProfile.availableFor,
        `${location}.availableFor`
    );

    let locationValue = null;
    if (rawProfile.location !== null) {
        locationValue = normalizeText(rawProfile.location, `${location}.location`, {
            maxLength: 120
        });
    }

    return {
        memberId,
        displayName,
        headline,
        bio,
        avatar,
        focus,
        socials,
        availableFor,
        location: locationValue
    };
}

function normalizeIsoDate(value, location, options = {}) {
    const { nullable = false } = options;
    if (value === null && nullable) return null;
    const normalized = normalizeText(value, location, { maxLength: 10 });
    const match = ISO_DATE_PATTERN.exec(normalized);
    if (!match) {
        throw new Error(`${location} must use the YYYY-MM-DD format.`);
    }

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw new Error(`${location} is not a real calendar date.`);
    }
    return normalized;
}

function normalizePostIndexEntry(rawPost, index) {
    const location = `posts-list.json[${index}]`;
    assertPlainObject(rawPost, location);
    assertAllowedKeys(rawPost, POST_INDEX_FIELDS, location);
    assertRequiredKeys(rawPost, [...POST_INDEX_FIELDS], location);

    const slug = normalizeText(rawPost.slug, `${location}.slug`, {
        maxLength: 100,
        pattern: SLUG_PATTERN
    });
    const title = normalizeText(rawPost.title, `${location}.title`, { maxLength: 160 });
    const excerpt = normalizeText(rawPost.excerpt, `${location}.excerpt`, { maxLength: 320 });
    const status = normalizeText(rawPost.status, `${location}.status`, { maxLength: 20 });
    if (!POST_STATUS_SET.has(status)) {
        throw new Error(`${location}.status must be one of: ${POST_STATUSES.join(', ')}.`);
    }

    const publishedAt = normalizeIsoDate(rawPost.publishedAt, `${location}.publishedAt`, {
        nullable: true
    });
    const updatedAt = normalizeIsoDate(rawPost.updatedAt, `${location}.updatedAt`, {
        nullable: true
    });
    if (status !== 'draft' && !publishedAt) {
        throw new Error(`${location}.publishedAt is required for ${status} posts.`);
    }
    if (publishedAt && updatedAt && updatedAt < publishedAt) {
        throw new Error(`${location}.updatedAt must not be earlier than publishedAt.`);
    }

    const tags = normalizeUniqueStringArray(rawPost.tags, `${location}.tags`, {
        maxItems: 20,
        itemMaxLength: 50,
        pattern: TAG_PATTERN,
        lowercase: true
    });
    if (!Number.isInteger(rawPost.readingMinutes) || rawPost.readingMinutes < 1 || rawPost.readingMinutes > 240) {
        throw new Error(`${location}.readingMinutes must be an integer from 1 to 240.`);
    }
    if (typeof rawPost.featured !== 'boolean') {
        throw new Error(`${location}.featured must be a boolean.`);
    }
    if (rawPost.featured && status !== 'published') {
        throw new Error(`${location}.featured may only be true for published posts.`);
    }

    return {
        slug,
        title,
        excerpt,
        publishedAt,
        updatedAt,
        tags,
        readingMinutes: rawPost.readingMinutes,
        featured: rawPost.featured,
        status
    };
}

function normalizePostsList(rawPosts) {
    if (!Array.isArray(rawPosts)) {
        throw new Error('posts-list.json root must be an array.');
    }

    const seenSlugs = new Map();
    return rawPosts.map((post, index) => {
        const normalized = normalizePostIndexEntry(post, index);
        if (seenSlugs.has(normalized.slug)) {
            throw new Error(
                `Duplicate post slug ${normalized.slug} in posts-list.json[${index}]; `
                + `first declared in posts-list.json[${seenSlugs.get(normalized.slug)}].`
            );
        }
        seenSlugs.set(normalized.slug, index);
        return normalized;
    });
}

function normalizeParagraphBlock(block, location) {
    const fields = new Set(['type', 'text']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'text'], location);
    return {
        type: 'paragraph',
        text: normalizeText(block.text, `${location}.text`, { maxLength: 10000 })
    };
}

function normalizeHeadingBlock(block, location) {
    const fields = new Set(['type', 'level', 'text']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'level', 'text'], location);
    if (!Number.isInteger(block.level) || block.level < 2 || block.level > 4) {
        throw new Error(`${location}.level must be the integer 2, 3, or 4.`);
    }
    return {
        type: 'heading',
        level: block.level,
        text: normalizeText(block.text, `${location}.text`, { maxLength: 200 })
    };
}

function normalizeListBlock(block, location) {
    const fields = new Set(['type', 'style', 'items']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'style', 'items'], location);
    const style = normalizeText(block.style, `${location}.style`, { maxLength: 20 });
    if (!LIST_STYLES.has(style)) {
        throw new Error(`${location}.style must be ordered or unordered.`);
    }
    const items = normalizeUniqueStringArray(block.items, `${location}.items`, {
        maxItems: 100,
        itemMaxLength: 2000
    });
    if (!items.length) {
        throw new Error(`${location}.items must contain at least one item.`);
    }
    return { type: 'list', style, items };
}

function normalizeCodeBlock(block, location) {
    const fields = new Set(['type', 'language', 'code', 'filename', 'caption']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'language', 'code'], location);
    return {
        type: 'code',
        language: normalizeText(block.language, `${location}.language`, {
            maxLength: 32,
            pattern: LANGUAGE_PATTERN
        }).toLowerCase(),
        code: normalizeVerbatimText(block.code, `${location}.code`),
        filename: normalizeOptionalText(block, 'filename', location, { maxLength: 160 }),
        caption: normalizeOptionalText(block, 'caption', location, { maxLength: 500 })
    };
}

function normalizeImageBlock(block, location) {
    const fields = new Set(['type', 'src', 'alt', 'caption', 'width', 'height']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'src', 'alt'], location);
    const hasWidth = hasOwn(block, 'width');
    const hasHeight = hasOwn(block, 'height');
    if (hasWidth !== hasHeight) {
        throw new Error(`${location}.width and ${location}.height must be provided together.`);
    }
    if (hasWidth) {
        for (const field of ['width', 'height']) {
            if (!Number.isInteger(block[field]) || block[field] < 1 || block[field] > 16384) {
                throw new Error(`${location}.${field} must be an integer from 1 to 16384.`);
            }
        }
    }
    return {
        type: 'image',
        src: normalizeSafeUrl(block.src, `${location}.src`),
        alt: normalizeText(block.alt, `${location}.alt`, { maxLength: 500 }),
        caption: normalizeOptionalText(block, 'caption', location, { maxLength: 1000 }),
        width: hasWidth ? block.width : null,
        height: hasHeight ? block.height : null
    };
}

function normalizeQuoteBlock(block, location) {
    const fields = new Set(['type', 'text', 'attribution', 'sourceUrl']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'text'], location);
    const sourceUrl = hasOwn(block, 'sourceUrl') && block.sourceUrl !== null
        ? normalizeSafeUrl(block.sourceUrl, `${location}.sourceUrl`, { allowFragment: true })
        : null;
    return {
        type: 'quote',
        text: normalizeText(block.text, `${location}.text`, { maxLength: 5000 }),
        attribution: normalizeOptionalText(block, 'attribution', location, { maxLength: 300 }),
        sourceUrl
    };
}

function normalizeCalloutBlock(block, location) {
    const fields = new Set(['type', 'tone', 'title', 'text']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'tone', 'text'], location);
    const tone = normalizeText(block.tone, `${location}.tone`, { maxLength: 20 });
    if (!CALLOUT_TONES.has(tone)) {
        throw new Error(`${location}.tone must be one of: ${[...CALLOUT_TONES].join(', ')}.`);
    }
    return {
        type: 'callout',
        tone,
        title: normalizeOptionalText(block, 'title', location, { maxLength: 200 }),
        text: normalizeText(block.text, `${location}.text`, { maxLength: 10000 })
    };
}

function normalizeReferencesBlock(block, location) {
    const fields = new Set(['type', 'items']);
    assertAllowedKeys(block, fields, location);
    assertRequiredKeys(block, ['type', 'items'], location);
    if (!Array.isArray(block.items) || !block.items.length) {
        throw new Error(`${location}.items must be a non-empty array.`);
    }
    if (block.items.length > 100) {
        throw new Error(`${location}.items must not contain more than 100 references.`);
    }

    const seenUrls = new Set();
    const items = block.items.map((item, index) => {
        const itemLocation = `${location}.items[${index}]`;
        assertPlainObject(item, itemLocation);
        assertAllowedKeys(item, new Set(['label', 'url']), itemLocation);
        assertRequiredKeys(item, ['label', 'url'], itemLocation);
        const label = normalizeText(item.label, `${itemLocation}.label`, { maxLength: 300 });
        const url = normalizeSafeUrl(item.url, `${itemLocation}.url`, { allowFragment: true });
        const urlKey = url.toLocaleLowerCase('en-US');
        if (seenUrls.has(urlKey)) {
            throw new Error(`${location}.items contains duplicate URL: ${url}.`);
        }
        seenUrls.add(urlKey);
        return { label, url };
    });

    return { type: 'references', items };
}

const BLOCK_NORMALIZERS = Object.freeze({
    paragraph: normalizeParagraphBlock,
    heading: normalizeHeadingBlock,
    list: normalizeListBlock,
    code: normalizeCodeBlock,
    image: normalizeImageBlock,
    quote: normalizeQuoteBlock,
    callout: normalizeCalloutBlock,
    references: normalizeReferencesBlock
});

function normalizeContentBlock(rawBlock, index) {
    const location = `post content[${index}]`;
    assertPlainObject(rawBlock, location);
    if (!hasOwn(rawBlock, 'type')) {
        throw new Error(`${location} is missing required field: type.`);
    }
    const type = normalizeText(rawBlock.type, `${location}.type`, { maxLength: 30 });
    if (!CONTENT_BLOCK_TYPE_SET.has(type)) {
        if (type.toLowerCase() === 'html') {
            throw new Error(`${location}.type cannot be html. Raw HTML content is not allowed.`);
        }
        throw new Error(
            `${location}.type must be one of: ${CONTENT_BLOCK_TYPES.join(', ')}.`
        );
    }
    return BLOCK_NORMALIZERS[type](rawBlock, location);
}

function normalizePostDocument(rawDocument, options = {}) {
    const location = options.location || 'post document';
    assertPlainObject(rawDocument, location);
    assertAllowedKeys(rawDocument, POST_DOCUMENT_FIELDS, location);
    assertRequiredKeys(rawDocument, [...POST_DOCUMENT_FIELDS], location);

    const slug = normalizeText(rawDocument.slug, `${location}.slug`, {
        maxLength: 100,
        pattern: SLUG_PATTERN
    });
    if (options.expectedSlug && slug !== options.expectedSlug) {
        throw new Error(
            `${location}.slug must match its posts-list.json entry: ${options.expectedSlug}.`
        );
    }
    if (!Array.isArray(rawDocument.content)) {
        throw new Error(`${location}.content must be an array of typed blocks.`);
    }
    if (!rawDocument.content.length && !options.allowEmptyContent) {
        throw new Error(`${location}.content must contain at least one typed block.`);
    }
    if (rawDocument.content.length > 500) {
        throw new Error(`${location}.content must not contain more than 500 blocks.`);
    }

    return {
        slug,
        content: rawDocument.content.map(normalizeContentBlock)
    };
}

function normalizePostDocumentsMap(postsBySlug) {
    if (postsBySlug instanceof Map) return new Map(postsBySlug);
    if (isPlainObject(postsBySlug)) return new Map(Object.entries(postsBySlug));
    throw new Error('postsBySlug must be a Map or an object keyed by post slug.');
}

function validateContentDataset({ profile, postsList, postsBySlug = {}, members } = {}) {
    const normalizedProfile = normalizeProfile(profile, { members });
    const normalizedPosts = normalizePostsList(postsList);
    const documents = normalizePostDocumentsMap(postsBySlug);
    const knownSlugs = new Set(normalizedPosts.map(post => post.slug));
    const normalizedDocuments = new Map();

    normalizedPosts.forEach(post => {
        if (!documents.has(post.slug)) {
            throw new Error(`Missing assets/data/posts/${post.slug}.json.`);
        }
        normalizedDocuments.set(post.slug, normalizePostDocument(documents.get(post.slug), {
            allowEmptyContent: post.status === 'draft',
            expectedSlug: post.slug,
            location: `assets/data/posts/${post.slug}.json`
        }));
    });

    documents.forEach((_document, slug) => {
        if (!knownSlugs.has(slug)) {
            throw new Error(
                `assets/data/posts/${slug}.json has no matching posts-list.json entry.`
            );
        }
    });

    return {
        profile: normalizedProfile,
        posts: normalizedPosts,
        postDocuments: normalizedDocuments,
        publishedPosts: normalizedPosts.filter(post => post.status === 'published')
    };
}

function getPublishedPosts(rawPosts) {
    return normalizePostsList(rawPosts).filter(post => post.status === 'published');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

module.exports = Object.freeze({
    CONTENT_BLOCK_TYPES,
    POST_STATUSES,
    escapeHtml,
    getPublishedPosts,
    isSafeContentUrl,
    normalizeContentBlock,
    normalizePostDocument,
    normalizePostsList,
    normalizeProfile,
    validateContentDataset
});
