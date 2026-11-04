'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { renderDocument } = require('../scripts/site-shell');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/startup-bootstrap.js'), 'utf8');

function setup({ reduced = false, hash = '', hidden = false, eligible = true } = {}) {
    let id = 0;
    let now = 0;
    const jobs = new Map();
    const requests = [];
    const target = extra => {
        const listeners = new Map();
        return Object.assign({
            addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
            removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
            dispatchEvent(event) { [...(listeners.get(event.type) || [])].forEach(fn => fn(event)); }
        }, extra);
    };
    const root = { dataset: { intro: String(eligible) } };
    const loader = { hidden: false };
    const document = target({ documentElement: root, hidden, body: null,
        getElementById: () => loader,
        fonts: { load(font) { return new Promise((resolve, reject) => requests.push({ font, resolve, reject })); } }
    });
    const motion = target({ matches: reduced });
    const context = target({ document, location: { hash }, matchMedia: () => motion, performance: { now: () => now }, console,
        setTimeout(fn, delay) { jobs.set(++id, { fn, delay }); return id; },
        clearTimeout(key) { jobs.delete(key); }
    });
    context.window = context;
    vm.createContext(context); vm.runInContext(source, context);
    const load = async () => {
        document.dispatchEvent({ type: 'load', target: { tagName: 'LINK', getAttribute: () => '/assets/css/base.css' } });
        await Promise.resolve();
    };
    const settle = async (fail = false) => {
        requests.forEach(request => fail ? request.reject(new Error('font 404')) : request.resolve([{ status: 'loaded' }]));
        await new Promise(resolve => setImmediate(resolve));
    };
    return { api: context.JazeStartup, root, document, motion, context, requests, jobs, loader, load, settle,
        elapse(ms) { now += ms; },
        timer(delay) { [...jobs.values()].find(job => job.delay === delay)?.fn(); } };
}

test('bootstrap gates before body exists and requires explicit loaded font faces', async () => {
    const s = setup();
    assert.equal(s.root.dataset.startup, 'preparing');
    assert.equal(s.document.body, null);
    assert.equal(s.api.play(), false);
    await s.load(); s.document.dispatchEvent({ type: 'DOMContentLoaded' });
    assert.equal(s.requests.length, 7, 'CSS load and DOMContentLoaded must not duplicate font requests');
    await s.settle();
    assert.equal(await s.api.fontsReady, 'ready');
    assert.equal(s.api.play(), true);
    assert.equal(s.root.dataset.startup, 'playing');
    s.api.reveal();
    assert.equal(s.root.dataset.startup, 'revealed');
    assert.equal(s.api.play(), false);
    assert.equal(s.jobs.size, 0);
});

test('preparation timeout releases UI independently of all deferred scripts', async () => {
    const s = setup(); await s.load(); s.timer(2500);
    assert.equal(s.api.getSnapshot().reason, 'preparation-timeout');
    assert.equal(await s.api.fontsReady, 'fallback');
    await s.settle();
    assert.equal(s.root.dataset.fonts, 'fallback', 'late font success cannot undo the fallback lock');
    assert.equal(s.api.play(), false);
    assert.equal(s.loader.hidden, true);
});

test('font failure/empty faces release with stable fallback', async () => {
    const failed = setup(); await failed.load(); await failed.settle(true);
    assert.equal(failed.api.getSnapshot().reason, 'font-error');
    assert.equal(failed.root.dataset.fonts, 'fallback');
    const empty = setup(); await empty.load(); empty.requests.forEach(r => r.resolve([]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(empty.root.dataset.startup, 'revealed');
    assert.equal(empty.root.dataset.fonts, 'fallback');
});

test('reduced motion and real anchors skip animation after font readiness', async () => {
    for (const options of [{ reduced: true }, { hash: '#research' }]) {
        const s = setup(options); await s.load(); await s.settle();
        assert.equal(s.root.dataset.startup, 'revealed');
        assert.equal(s.root.dataset.fonts, 'ready');
        assert.equal(s.api.play(), false);
    }
    const model = setup({ hash: '#model=gyroid' }); await model.load(); await model.settle();
    assert.equal(model.api.play(), true);
});

test('input, hidden document, BFCache departure and missing font API fail open', async () => {
    for (const event of ['keydown', 'pointerdown', 'wheel', 'pagehide']) {
        const s = setup(); s.context.dispatchEvent({ type: event, key: 'Escape' });
        assert.equal(s.root.dataset.startup, 'revealed');
        assert.equal(s.api.play(), false);
    }
    assert.equal(setup({ hidden: true }).root.dataset.startup, 'revealed');
    const s = setup(); delete s.document.fonts; await s.load();
    assert.equal(await s.api.fontsReady, 'fallback');
    assert.equal(s.api.getSnapshot().reason, 'font-api-unavailable');
});

test('independent watchdog terminates a playing intro when controller is absent', async () => {
    const s = setup(); await s.load(); await s.settle(); s.api.play(); s.timer(6500);
    assert.equal(s.api.getSnapshot().reason, 'startup-watchdog');
    assert.equal(s.root.dataset.startup, 'revealed');
    assert.equal(s.api.play(), false);
    assert.equal(s.root.dataset.fonts, 'ready');
});

test('overdue preparation cannot start even if a long task delayed its timer', async () => {
    const s = setup(); await s.load(); await s.settle(); s.elapse(2800);
    assert.equal(s.api.play(), false);
    assert.equal(s.api.getSnapshot().reason, 'preparation-timeout');
    assert.equal(s.root.dataset.startup, 'revealed');
});

test('synchronous Font Loading API errors also fail open', async () => {
    const s = setup(); s.document.fonts.load = () => { throw new Error('broken font API'); };
    await s.load(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.root.dataset.startup, 'revealed');
    assert.equal(await s.api.fontsReady, 'fallback');
});

test('only homepage emits pre-paint bootstrap and exact CSP hashes; fonts remain self-hosted', () => {
    const home = renderDocument({ activePage: 'profile', scripts: ['intro-loader.js'], body: '<main>Home</main>' });
    assert.ok(home.indexOf('data-startup-bootstrap') < home.indexOf('<link rel="stylesheet"'));
    assert.ok(home.indexOf('data-startup-critical') < home.indexOf('data-startup-bootstrap'));
    for (const match of home.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        if (/\bsrc=/.test(match[2])) continue;
        const hash = crypto.createHash('sha256').update(match[3], 'utf8').digest('base64');
        assert.ok(home.includes(`sha256-${hash}`));
    }
    assert.doesNotMatch(home, /unsafe-inline|unsafe-eval|fonts\.googleapis|fonts\.gstatic/);
    assert.equal((home.match(/as="font" type="font\/ttf" crossorigin/g) || []).length, 4);
    assert.doesNotMatch(home, /<html[^>]*data-startup=|<body[^>]*intro-active/);
    const subpage = renderDocument({ activePage: 'cves', body: '<main>CVE</main>' });
    assert.doesNotMatch(subpage, /data-startup-bootstrap|data-startup-critical|rel="preload"/);
});
