'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const profileData = require('../assets/data/profile.json');
const postsListData = require('../assets/data/posts-list.json');
const samplePostDocument = require('../assets/data/posts/local-first-cve-research-notes.json');
const {
    CONTENT_BLOCK_TYPES,
    POST_STATUSES,
    escapeHtml,
    getPublishedPosts,
    isSafeContentUrl,
    normalizePostDocument,
    normalizePostsList,
    normalizeProfile,
    validateContentDataset
} = require('../scripts/content-contracts');

function createProfile(overrides = {}) {
    return {
        memberId: 'jaze',
        displayName: 'Jaze',
        headline: 'A Security Researcher From V1T',
        bio: '',
        avatar: '/assets/images/jaze_v1t.png',
        focus: [],
        socials: [
            {
                label: 'CTFtime',
                url: 'https://ctftime.org/user/172832'
            }
        ],
        availableFor: [],
        location: null,
        ...overrides
    };
}

function createPost(overrides = {}) {
    return {
        slug: 'finding-an-example-bug',
        title: 'Finding an example bug',
        excerpt: 'A technical research note used to exercise the content contract.',
        publishedAt: '2026-10-20',
        updatedAt: '2026-10-24',
        tags: ['web-security', 'research'],
        readingMinutes: 8,
        featured: false,
        status: 'published',
        ...overrides
    };
}

function createDocument(slug = 'finding-an-example-bug') {
    return {
        slug,
        content: [
            {
                type: 'paragraph',
                text: 'A concise introduction to the research.'
            },
            {
                type: 'heading',
                level: 2,
                text: 'Technical details'
            },
            {
                type: 'list',
                style: 'unordered',
                items: ['First observation', 'Second observation']
            },
            {
                type: 'code',
                language: 'html',
                code: '  <script>alert("escaped by renderer")</script>\n',
                filename: 'proof-of-concept.html',
                caption: 'Illustrative code, not raw document HTML.'
            },
            {
                type: 'image',
                src: '/assets/images/research/example.png',
                alt: 'A diagram of the request flow',
                caption: 'Request flow',
                width: 1280,
                height: 720
            },
            {
                type: 'quote',
                text: 'A short attributed quotation.',
                attribution: 'Example source',
                sourceUrl: 'https://example.com/source'
            },
            {
                type: 'callout',
                tone: 'warning',
                title: 'Scope',
                text: 'Only test systems you are authorized to assess.'
            },
            {
                type: 'references',
                items: [
                    { label: 'External advisory', url: 'https://example.com/advisory' },
                    { label: 'Related CVE', url: '/cves/CVE-2026-10001/' }
                ]
            }
        ]
    };
}

test('the checked-in profile is truthful, normalized, and linked to a known V1T member', () => {
    const normalized = normalizeProfile(profileData, {
        members: [{ id: 'rawr' }, { id: 'jaze' }]
    });

    assert.equal(normalized.memberId, 'jaze');
    assert.equal(normalized.displayName, 'Jaze');
    assert.equal(normalized.headline, 'A Security Researcher From V1T');
    assert.equal(normalized.bio, '');
    assert.deepEqual(normalized.focus, []);
    assert.deepEqual(normalized.availableFor, []);
    assert.equal(normalized.location, null);
    assert.deepEqual(normalized.socials, [{
        label: 'CTFtime',
        url: 'https://ctftime.org/user/172832'
    }]);
    assert.equal(Object.hasOwn(normalized, 'cveCount'), false);
    assert.equal(Object.hasOwn(normalized, 'postCount'), false);
});

test('profile validation rejects unknown members, raw HTML fields, unsafe links, and duplicates', () => {
    assert.throws(
        () => normalizeProfile(createProfile(), { members: [{ id: 'rawr' }] }),
        /does not exist in members\.json/
    );
    assert.throws(
        () => normalizeProfile(createProfile({ bioHtml: '<strong>Jaze</strong>' })),
        /raw HTML field/i
    );
    assert.throws(
        () => normalizeProfile(createProfile({ cveCount: 25 })),
        /unsupported field.*cveCount/
    );
    assert.throws(
        () => normalizeProfile(createProfile({ avatar: 'javascript:alert(1)' })),
        /only permits HTTP\(S\)/
    );
    assert.throws(
        () => normalizeProfile(createProfile({
            socials: [{ label: 'Unsafe', url: '/not-an-external-profile' }]
        })),
        /absolute HTTP\(S\) URL/
    );
    assert.throws(
        () => normalizeProfile(createProfile({ focus: ['Web Security', 'web security'] })),
        /duplicate value/
    );
});

test('profile member lookup accepts mixed-case ids from the shared V1T member data', () => {
    const normalized = normalizeProfile(createProfile(), {
        members: [{ id: 'Jaze' }, { id: 'coldB' }]
    });

    assert.equal(normalized.memberId, 'jaze');
});

test('post index accepts supported statuses and exposes only published entries', () => {
    const posts = normalizePostsList([
        createPost(),
        createPost({
            slug: 'unfinished-note',
            title: 'Unfinished note',
            publishedAt: null,
            updatedAt: '2026-10-24',
            tags: ['draft'],
            featured: false,
            status: 'draft'
        }),
        createPost({
            slug: 'retired-note',
            title: 'Retired note',
            status: 'archived'
        })
    ]);

    assert.deepEqual(POST_STATUSES, ['draft', 'published', 'archived']);
    assert.equal(posts.length, 3);
    assert.deepEqual(getPublishedPosts(posts).map(post => post.slug), [
        'finding-an-example-bug'
    ]);
});

test('post index rejects duplicate slugs and invalid slug, date, tag, status, or publication state', () => {
    assert.throws(
        () => normalizePostsList([createPost(), createPost()]),
        /Duplicate post slug/
    );
    assert.throws(
        () => normalizePostsList([createPost({ slug: 'Not A Slug' })]),
        /slug has an invalid format/
    );
    assert.throws(
        () => normalizePostsList([createPost({ publishedAt: '2026-02-30' })]),
        /not a real calendar date/
    );
    assert.throws(
        () => normalizePostsList([createPost({ updatedAt: '2026-10-19' })]),
        /must not be earlier than publishedAt/
    );
    assert.throws(
        () => normalizePostsList([createPost({ tags: ['Web Security'] })]),
        /tags\[0\] has an invalid format/
    );
    assert.throws(
        () => normalizePostsList([createPost({ status: 'scheduled' })]),
        /status must be one of/
    );
    assert.throws(
        () => normalizePostsList([createPost({
            status: 'draft',
            publishedAt: null,
            featured: true
        })]),
        /featured may only be true for published posts/
    );
    assert.throws(
        () => normalizePostsList([createPost({
            status: 'archived',
            publishedAt: null
        })]),
        /publishedAt is required for archived posts/
    );
});

test('all eight typed content blocks normalize without interpreting code as document HTML', () => {
    const document = normalizePostDocument(createDocument());

    assert.deepEqual(document.content.map(block => block.type), CONTENT_BLOCK_TYPES);
    assert.equal(
        document.content.find(block => block.type === 'code').code,
        '  <script>alert("escaped by renderer")</script>\n'
    );
    assert.equal(document.content.find(block => block.type === 'image').caption, 'Request flow');
    assert.equal(document.content.find(block => block.type === 'image').width, 1280);
    assert.equal(document.content.find(block => block.type === 'image').height, 720);
    assert.equal(document.content.find(block => block.type === 'quote').sourceUrl, 'https://example.com/source');
});

test('content blocks reject raw HTML fields, untyped HTML, invalid structure, and unsafe URLs', () => {
    assert.throws(
        () => normalizePostDocument({
            slug: 'unsafe-post',
            content: [{ type: 'html', html: '<img src=x onerror=alert(1)>' }]
        }),
        /Raw HTML content is not allowed/
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'unsafe-post',
            content: [{ type: 'paragraph', text: 'Text', rawHtml: '<b>Text</b>' }]
        }),
        /raw HTML field/i
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'unsafe-post',
            content: [{ type: 'image', src: 'data:image/svg+xml,<svg/>', alt: 'Unsafe image' }]
        }),
        /only permits HTTP\(S\)/
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'unsafe-post',
            content: [{ type: 'image', src: '/assets/image.png', alt: 'Incomplete dimensions', width: 800 }]
        }),
        /width and .*height must be provided together/
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'unsafe-post',
            content: [{
                type: 'references',
                items: [{ label: 'Unsafe', url: '/safe/../private' }]
            }]
        }),
        /unsafe local path segment/
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'invalid-heading',
            content: [{ type: 'heading', level: 1, text: 'Duplicate page title' }]
        }),
        /level must be the integer 2, 3, or 4/
    );
    assert.throws(
        () => normalizePostDocument({
            slug: 'empty-list',
            content: [{ type: 'list', style: 'unordered', items: [] }]
        }),
        /must contain at least one item/
    );
});

test('URL checks reject executable protocols and accept HTTP(S), root-relative, and safe relative paths', () => {
    assert.equal(isSafeContentUrl('https://example.com/research?id=1#result'), true);
    assert.equal(isSafeContentUrl('http://example.com/advisory'), true);
    assert.equal(isSafeContentUrl('/assets/images/example.png'), true);
    assert.equal(isSafeContentUrl('assets/images/example.png'), true);
    assert.equal(isSafeContentUrl('javascript:alert(1)'), false);
    assert.equal(isSafeContentUrl('data:text/html,unsafe'), false);
    assert.equal(isSafeContentUrl('//evil.example/path'), false);
    assert.equal(isSafeContentUrl('/assets/%2e%2e/secret'), false);
});

test('dataset validation connects index entries to documents and excludes drafts from public output', () => {
    const published = createPost();
    const draft = createPost({
        slug: 'private-draft',
        title: 'Private draft',
        publishedAt: null,
        updatedAt: null,
        tags: ['draft'],
        readingMinutes: 1,
        status: 'draft'
    });
    const result = validateContentDataset({
        profile: createProfile(),
        members: [{ id: 'jaze' }],
        postsList: [published, draft],
        postsBySlug: {
            [published.slug]: createDocument(published.slug),
            [draft.slug]: { slug: draft.slug, content: [] }
        }
    });

    assert.deepEqual(result.publishedPosts.map(post => post.slug), [published.slug]);
    assert.equal(result.postDocuments.size, 2);
});

test('dataset validation rejects missing, mismatched, and orphaned post documents', () => {
    const post = createPost();
    assert.throws(
        () => validateContentDataset({
            profile: createProfile(),
            members: [{ id: 'jaze' }],
            postsList: [post],
            postsBySlug: {}
        }),
        /Missing assets\/data\/posts\/finding-an-example-bug\.json/
    );
    assert.throws(
        () => validateContentDataset({
            profile: createProfile(),
            members: [{ id: 'jaze' }],
            postsList: [post],
            postsBySlug: {
                [post.slug]: createDocument('different-slug')
            }
        }),
        /slug must match its posts-list\.json entry/
    );
    assert.throws(
        () => validateContentDataset({
            profile: createProfile(),
            members: [{ id: 'jaze' }],
            postsList: [],
            postsBySlug: {
                orphan: { slug: 'orphan', content: [] }
            }
        }),
        /has no matching posts-list\.json entry/
    );
});

test('checked-in sample post is valid and HTML escaping covers executable markup', () => {
    const posts = normalizePostsList(postsListData);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].slug, 'local-first-cve-research-notes');
    assert.equal(getPublishedPosts(posts).length, 1);
    const document = normalizePostDocument(samplePostDocument, {
        expectedSlug: posts[0].slug
    });
    assert.equal(document.slug, posts[0].slug);
    assert.ok(document.content.length > 0);
    assert.equal(
        escapeHtml('<script data-x="1">\'unsafe\' & more</script>'),
        '&lt;script data-x=&quot;1&quot;&gt;&#39;unsafe&#39; &amp; more&lt;/script&gt;'
    );
});
