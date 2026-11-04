(function prepareStartup() {
    'use strict';

    // Inlined (with a build-time CSP hash) before stylesheets/body. HTML stays
    // readable if scripts are disabled or this bootstrap is blocked.
    const root = document.documentElement;
    if (root.dataset.intro !== 'true' || window.JazeStartup) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preparationDeadline = performance.now() + 2500;
    const anchor = window.location.hash && !/^#model=/i.test(window.location.hash);
    let phase = 'preparing';
    let reason = '';
    let fonts = 'pending';
    let loadingFonts = false;
    let preparationTimer;
    let watchdog;
    let resolveFonts;
    const fontsReady = new Promise(resolve => { resolveFonts = resolve; });
    const listeners = new Set();
    const requiredFonts = [
        '400 16px "Anta"',
        '400 16px "Chakra Petch"', '500 16px "Chakra Petch"',
        '600 16px "Chakra Petch"', '700 16px "Chakra Petch"',
        '400 16px "IBM Plex Mono"', '700 16px "IBM Plex Mono"'
    ];

    function snapshot() { return Object.freeze({ phase, reason, fonts }); }
    function notify() {
        const state = snapshot();
        listeners.forEach(listener => {
            try { listener(state); } catch (error) { console.warn('[Jaze startup]', error); }
        });
    }
    function settleFonts(value) {
        if (fonts !== 'pending') return;
        fonts = value;
        root.dataset.fonts = value;
        resolveFonts(value);
    }
    function reveal(nextReason = 'complete') {
        if (phase === 'revealed') return false;
        // Commit a stable system-font fallback; late network responses cannot
        // change typography or the ASCII atlas during this navigation.
        settleFonts('fallback');
        phase = 'revealed';
        reason = nextReason;
        root.dataset.startup = phase;
        window.clearTimeout(preparationTimer);
        window.clearTimeout(watchdog);
        document.body?.classList.remove('intro-active');
        const loader = document.getElementById('intro-loader');
        if (loader) loader.hidden = true;
        document.removeEventListener('load', onStylesheet, true);
        document.removeEventListener('DOMContentLoaded', loadFonts);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('keydown', onInput, true);
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('wheel', onInput, true);
        motion.removeEventListener('change', onMotion);
        notify();
        listeners.clear();
        return true;
    }
    function play() {
        if (phase !== 'preparing' || fonts !== 'ready') return false;
        if (performance.now() >= preparationDeadline) { reveal('preparation-timeout'); return false; }
        if (motion.matches || anchor || document.hidden) { reveal('ineligible'); return false; }
        phase = 'playing';
        root.dataset.startup = phase;
        window.clearTimeout(preparationTimer);
        notify();
        return true;
    }
    function loadFonts() {
        if (loadingFonts || phase === 'revealed') return;
        loadingFonts = true;
        if (!document.fonts?.load) { reveal('font-api-unavailable'); return; }
        Promise.resolve().then(() => Promise.all(requiredFonts.map(font => document.fonts.load(font)))).then(groups => {
            if (phase === 'revealed') return;
            if (groups.some(group => !group.length || group.some(face => face.status !== 'loaded'))) {
                reveal('font-error'); return;
            }
            settleFonts('ready');
            if (motion.matches) reveal('reduced-motion');
            else if (anchor) reveal('anchor');
            else notify();
        }).catch(() => reveal('font-error'));
    }
    function onStylesheet(event) {
        if (event.target.tagName === 'LINK' && event.target.getAttribute('href') === '/assets/css/base.css') loadFonts();
    }
    function onInput(event) { reveal(event.type === 'keydown' && event.key === 'Escape' ? 'escape' : 'interaction'); }
    function onMotion() { if (motion.matches) reveal('reduced-motion'); }
    function onVisibility() { if (document.hidden) reveal('hidden'); }
    function onPageHide() { reveal('pagehide'); }

    window.JazeStartup = Object.freeze({
        getSnapshot: snapshot, fontsReady, play, reveal,
        subscribe(listener) {
            if (phase !== 'revealed') listeners.add(listener);
            try { listener(snapshot()); } catch (error) { console.warn('[Jaze startup]', error); }
            return () => listeners.delete(listener);
        }
    });
    // Arm both release paths BEFORE concealing anything. Neither relies on
    // deferred scripts, WebGL, a font promise, or CSS animations completing.
    preparationTimer = window.setTimeout(() => reveal('preparation-timeout'), 2500);
    watchdog = window.setTimeout(() => reveal('startup-watchdog'), 6500);
    root.dataset.fonts = fonts;
    root.dataset.startup = phase;
    document.addEventListener('load', onStylesheet, true);
    document.addEventListener('DOMContentLoaded', loadFonts, { once: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, { capture: true, passive: true });
    window.addEventListener('wheel', onInput, { capture: true, passive: true });
    motion.addEventListener('change', onMotion);
    if (document.hidden) reveal('hidden');
}());
