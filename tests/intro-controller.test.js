'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderDocument } = require('../scripts/site-shell');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/intro-controller.js'), 'utf8');

function setup({ reduced = false, hash = '', time = 100, eligible = true, bootstrap = true } = {}) {
    let now = time;
    let sequence = 0;
    const jobs = new Map();
    const observers = new Set();
    const events = [];
    function target(extra = {}) {
        const listeners = new Map();
        return Object.assign({
            addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
            removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
            dispatchEvent(event) { [...(listeners.get(event.type) || [])].forEach(fn => fn(event)); return true; }
        }, extra);
    }
    const classes = new Set(['bg-blur-active', 'green-boost-active']);
    const body = { dataset: { intro: String(eligible) }, classList: {
        add(name) { classes.add(name); observers.forEach(fn => fn()); },
        remove(name) { classes.delete(name); observers.forEach(fn => fn()); },
        contains: name => classes.has(name)
    } };
    const loaderClasses = new Set();
    const loader = { hidden: true, classList: { add: name => loaderClasses.add(name), remove: name => loaderClasses.delete(name) } };
    const clock = { textContent: '' };
    const document = target({ body, hidden: false, getElementById: id => id === 'intro-loader' ? loader : null,
        querySelector: selector => selector === '[data-loader-clock]' ? clock : null });
    const motion = target({ matches: reduced });
    const schedule = (callback, delay, interval = false) => { const id = ++sequence; jobs.set(id, { callback, at: now + delay, delay, interval }); return id; };
    const context = target({ document, location: { hash }, performance: { now: () => now }, matchMedia: () => motion,
        setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => jobs.delete(id),
        setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => jobs.delete(id),
        console: { warn() {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        MutationObserver: class {
            constructor(fn) { this.fn = fn; }
            observe() { observers.add(this.fn); }
            disconnect() { observers.delete(this.fn); }
        }
    });
    context.window = context;
    if (bootstrap) {
        let phase = 'preparing';
        let reason = '';
        const subscribers = new Set();
        const pending = schedule(() => context.JazeStartup.reveal('preparation-timeout'), 2500);
        context.JazeStartup = {
            getSnapshot: () => ({ phase, reason, fonts: 'ready' }),
            play() { if (phase !== 'preparing') return false; phase = 'playing'; jobs.delete(pending); return true; },
            reveal(nextReason) {
                if (phase === 'revealed') return false;
                phase = 'revealed'; reason = nextReason; jobs.delete(pending);
                subscribers.forEach(fn => fn(this.getSnapshot())); return true;
            },
            subscribe(fn) { subscribers.add(fn); fn(this.getSnapshot()); return () => subscribers.delete(fn); }
        };
    }
    context.addEventListener('jaze:introchange', event => events.push(event.detail));
    vm.createContext(context); vm.runInContext(source, context);
    function advance(ms) {
        const until = now + ms;
        for (;;) {
            const next = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) break;
            const [id, job] = next; now = job.at;
            if (!job.interval) jobs.delete(id);
            job.callback();
            if (job.interval && jobs.has(id)) job.at = now + job.delay;
        }
        now = until;
    }
    return { api: context.JazeIntro, context, body, loader, clock, motion, events, advance, jobs, document };
}

test('HTML is fail-open, loader/controller readiness is not encoded as intro-active', () => {
    const html = renderDocument({ activePage: 'profile', scripts: ['intro-loader.js'], body: '<main>Readable</main>' });
    assert.match(html, /data-intro="true"/);
    assert.doesNotMatch(html, /<body[^>]*intro-active/);
    assert.doesNotMatch(html, /\sstyle=/);
    assert.ok(html.indexOf('/intro-controller.js') < html.indexOf('/ascii-webgl-renderer.js'));
});

test('ready engine plays once, finishes after 3s, releases UI before scene callback', () => {
    const s = setup();
    assert.equal(s.body.classList.contains('intro-active'), false);
    assert.equal(s.api.start(), true);
    assert.equal(s.loader.hidden, false);
    assert.equal(s.body.classList.contains('intro-active'), true);
    s.api.subscribe(state => { if (state.status === 'finished') assert.equal(s.body.classList.contains('intro-active'), false); });
    s.advance(3000);
    assert.equal(s.api.getSnapshot().status, 'finished');
    assert.equal(s.api.start(), false);
    assert.equal(s.api.finish(), false);
    assert.equal(s.events.filter(e => e.status === 'finished').length, 1);
    assert.equal(s.body.classList.contains('green-boost-active'), true);
    s.advance(800); assert.equal(s.loader.hidden, true);
    assert.equal(s.jobs.size, 0);
});

test('absent/late engine never hides content and late subscribers read terminal snapshot', () => {
    const s = setup(); s.advance(2500);
    assert.equal(s.api.getSnapshot().reason, 'preparation-timeout');
    assert.equal(s.api.start(), false);
    let state; s.api.subscribe(value => { state = value.status; });
    assert.equal(state, 'skipped');
    assert.equal(s.body.classList.contains('intro-active'), false);
    assert.equal(s.loader.hidden, true);
});

test('disabled or missing bootstrap skip without hiding content', () => {
    for (const options of [{ eligible: false }, { bootstrap: false }]) {
        const s = setup(options);
        assert.equal(s.api.getSnapshot().status, 'skipped');
        assert.equal(s.api.start(), false);
        assert.equal(s.loader.hidden, true);
        assert.equal(s.body.classList.contains('intro-active'), false);
    }
    assert.equal(setup({ hash: '#model=gyroid' }).api.getSnapshot().status, 'idle');
});

test('a slow first frame can play only while the pre-paint gate is still closed', () => {
    const s = setup({ time: 1200 });
    assert.equal(s.api.start(), true);
    const released = setup();
    released.context.JazeStartup.reveal('font-error');
    assert.equal(released.api.start(), false);
    assert.equal(released.body.classList.contains('intro-active'), false);
});

test('Escape racing natural timer finishes once; no delayed replay', () => {
    const s = setup(); s.api.start(); s.advance(2950);
    s.context.dispatchEvent({ type: 'keydown', key: 'Escape' }); s.advance(6000);
    assert.equal(s.api.getSnapshot().reason, 'escape');
    assert.equal(s.events.filter(e => e.status === 'finished').length, 1);
    assert.equal(s.jobs.size, 0);
});

test('motion changes, visibility, external reveal and engine failure all terminate safely', () => {
    const actions = [
        s => { s.motion.matches = true; s.motion.dispatchEvent({ type: 'change' }); },
        s => { s.document.hidden = true; s.document.dispatchEvent({ type: 'visibilitychange' }); },
        s => s.body.classList.remove('intro-active'),
        s => s.api.fail()
    ];
    for (const action of actions) {
        const s = setup(); s.api.start(); action(s); s.advance(1000);
        assert.equal(s.body.classList.contains('intro-active'), false);
        assert.equal(s.loader.hidden, true);
        assert.equal(s.api.start(), false);
    }
});

test('input before engine readiness skips; listener errors and duplicate loading cannot lock UI', () => {
    const s = setup();
    const original = s.api;
    vm.runInContext(source, s.context);
    assert.equal(s.context.JazeIntro, original);
    s.api.subscribe(() => { throw new Error('scene failure'); });
    s.context.dispatchEvent({ type: 'pointerdown' });
    assert.equal(s.api.getSnapshot().reason, 'interaction');
    assert.equal(s.api.start(), false);
    assert.equal(s.body.classList.contains('intro-active'), false);
});

test('watchdog reveals even if normal completion timer is lost', () => {
    const s = setup(); s.api.start();
    for (const [id, job] of s.jobs) if (!job.interval && job.delay === 3000) s.jobs.delete(id);
    s.advance(4000);
    assert.equal(s.api.getSnapshot().reason, 'watchdog');
    assert.equal(s.body.classList.contains('intro-active'), false);
});
