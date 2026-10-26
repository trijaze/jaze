(function initBlogArchiveModule() {
    'use strict';

    const DEFAULTS = Object.freeze({ query: '', tag: 'all', sort: 'newest' });
    const SEARCH_DELAY_MS = 140;

    function normalize(value) {
        return String(value || '').trim().toLocaleLowerCase('en');
    }

    function parseTags(value) {
        const raw = String(value || '').trim();
        if (!raw) return [];

        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(normalize).filter(Boolean);
            } catch {
                // Fall through to the compact, pipe-delimited representation.
            }
        }

        return raw.split(/[|,;]/).map(normalize).filter(Boolean);
    }

    function parseDate(value) {
        const timestamp = Date.parse(value || '');
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function init() {
        const root = document.querySelector('[data-blog-archive]');
        if (!root) return;

        const controls = Object.freeze({
            search: root.querySelector('[data-blog-search]'),
            tag: root.querySelector('[data-blog-tag]'),
            sort: root.querySelector('[data-blog-sort]')
        });
        const list = root.querySelector('[data-blog-list]');
        const count = root.querySelector('[data-blog-visible-count]');
        const empty = root.querySelector('[data-blog-empty]');
        const status = root.querySelector('[data-blog-status]');
        const posts = [...root.querySelectorAll('[data-blog-item]')].map((item, index) => {
            const title = item.dataset.title || '';
            const excerpt = item.dataset.excerpt || '';
            return {
                date: parseDate(item.dataset.date),
                index,
                item,
                searchText: normalize([title, excerpt, item.textContent].filter(Boolean).join(' ')),
                tags: parseTags(item.dataset.tags),
                title: normalize(title || item.querySelector('h2, h3')?.textContent)
            };
        });
        let searchTimer = 0;
        let state = readUrlState();

        function readUrlState() {
            const params = new URL(window.location.href).searchParams;
            return {
                query: String(params.get('q') || '').trim().slice(0, 200),
                tag: normalize(params.get('tag')) || DEFAULTS.tag,
                sort: normalize(params.get('sort')) || DEFAULTS.sort
            };
        }

        function optionValue(control, requested, fallback) {
            const normalizedRequested = normalize(requested);
            if (!control) return normalizedRequested || fallback;
            const option = [...control.options].find(candidate => normalize(candidate.value) === normalizedRequested);
            const fallbackOption = [...control.options].find(candidate => normalize(candidate.value) === fallback);
            return option?.value || fallbackOption?.value || control.value;
        }

        function hydrateControls() {
            if (controls.search) controls.search.value = state.query;
            if (controls.tag) {
                controls.tag.value = optionValue(controls.tag, state.tag, DEFAULTS.tag);
                state.tag = normalize(controls.tag.value) || DEFAULTS.tag;
            }
            if (controls.sort) {
                controls.sort.value = optionValue(controls.sort, state.sort, DEFAULTS.sort);
                state.sort = normalize(controls.sort.value) || DEFAULTS.sort;
            }
        }

        function readControls() {
            state.query = String(controls.search?.value || '').trim().slice(0, 200);
            state.tag = normalize(controls.tag?.value) || DEFAULTS.tag;
            state.sort = normalize(controls.sort?.value) || DEFAULTS.sort;
        }

        function writeUrl(mode) {
            const url = new URL(window.location.href);
            const setOptional = (key, value, defaultValue = '') => {
                if (value && value !== defaultValue) url.searchParams.set(key, value);
                else url.searchParams.delete(key);
            };

            setOptional('q', state.query);
            setOptional('tag', state.tag, DEFAULTS.tag);
            setOptional('sort', state.sort, DEFAULTS.sort);

            const next = `${url.pathname}${url.search}${url.hash}`;
            const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (next === current) return;
            window.history[mode === 'push' ? 'pushState' : 'replaceState']({ blogArchive: true }, '', next);
        }

        function comparePosts(a, b) {
            switch (state.sort) {
                case 'oldest':
                    return (a.date - b.date) || a.title.localeCompare(b.title, 'en') || (a.index - b.index);
                case 'title':
                case 'title-asc':
                    return a.title.localeCompare(b.title, 'en') || (b.date - a.date) || (a.index - b.index);
                case 'title-desc':
                    return b.title.localeCompare(a.title, 'en') || (b.date - a.date) || (a.index - b.index);
                case 'newest':
                default:
                    return (b.date - a.date) || a.title.localeCompare(b.title, 'en') || (a.index - b.index);
            }
        }

        function matches(post) {
            if (state.query && !post.searchText.includes(normalize(state.query))) return false;
            if (state.tag !== 'all' && !post.tags.includes(state.tag)) return false;
            return true;
        }

        function render() {
            if (list) {
                const fragment = document.createDocumentFragment();
                [...posts].sort(comparePosts).forEach(post => fragment.append(post.item));
                list.append(fragment);
            }

            let visible = 0;
            posts.forEach(post => {
                const isVisible = matches(post);
                post.item.hidden = !isVisible;
                if (isVisible) visible += 1;
            });

            if (count) count.textContent = String(visible);
            if (empty) empty.hidden = visible !== 0;
            if (status) {
                if (posts.length === 0) status.textContent = 'No published research posts yet.';
                else if (visible === 1) status.textContent = 'Showing 1 research post.';
                else status.textContent = `Showing ${visible} of ${posts.length} research posts.`;
            }
        }

        function apply(mode) {
            readControls();
            render();
            writeUrl(mode);
        }

        controls.search?.addEventListener('input', () => {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => apply('replace'), SEARCH_DELAY_MS);
        });
        [controls.tag, controls.sort].forEach(control => {
            control?.addEventListener('change', () => apply('push'));
        });

        root.addEventListener('submit', event => {
            if (!event.target.closest('form')) return;
            event.preventDefault();
            window.clearTimeout(searchTimer);
            apply('push');
        });

        window.addEventListener('popstate', () => {
            window.clearTimeout(searchTimer);
            state = readUrlState();
            hydrateControls();
            render();
        });

        hydrateControls();
        render();
        root.dataset.enhanced = 'true';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
