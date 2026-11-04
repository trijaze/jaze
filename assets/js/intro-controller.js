(function initIntroController() {
    'use strict';

    if (!document.body || window.JazeIntro) return;
    const body = document.body;
    const loader = document.getElementById('intro-loader');
    const clock = document.querySelector('[data-loader-clock]');
    const progress = document.querySelector('[data-loader-progress]');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const startup = window.JazeStartup;
    const durationMs = 3000;
    const listeners = new Set();
    let status = 'idle';
    let reason = '';
    let startedAt = null;
    let unsubscribeStartup;
    let finishTimer;
    let watchdog;
    let clockTimer;
    let hideTimer;
    let observer;

    function snapshot() {
        return Object.freeze({ status, reason, startedAt, durationMs,
            elapsedMs: startedAt === null ? 0 : Math.min(durationMs, Math.max(0, performance.now() - startedAt)) });
    }

    function notify() {
        const state = snapshot();
        listeners.forEach(listener => {
            try { listener(state); } catch (error) { console.warn('[Jaze intro] Scene listener failed:', error); }
        });
        window.dispatchEvent(new CustomEvent('jaze:introchange', { detail: state }));
    }

    function terminal() { return status !== 'idle' && status !== 'playing'; }

    function updateClock() {
        const elapsed = snapshot().elapsedMs;
        const remaining = Math.max(0, (durationMs - elapsed) / 1000);
        if (clock) clock.textContent = `00:${String(Math.floor(remaining)).padStart(2, '0')}.${String(Math.floor((remaining % 1) * 100)).padStart(2, '0')}`;
        if (progress) progress.style.width = `${(elapsed / durationMs * 100).toFixed(1)}%`;
    }

    // Reveal first; scene callbacks cannot keep the content locked if they fail.
    function finish(nextReason = 'complete') {
        if (terminal()) return false;
        const wasPlaying = status === 'playing';
        status = nextReason === 'engine-error' ? 'failed'
            : ['complete', 'escape'].includes(nextReason) ? 'finished' : 'skipped';
        reason = nextReason;
        window.clearTimeout(finishTimer);
        window.clearTimeout(watchdog);
        window.clearInterval(clockTimer);
        observer?.disconnect();
        unsubscribeStartup?.();
        body.classList.remove('intro-active');
        startup?.reveal(nextReason);
        if (loader) {
            if (wasPlaying && !motion.matches) {
                loader.hidden = false;
                loader.classList.add('intro-loader--dissolving');
                hideTimer = window.setTimeout(() => { loader.hidden = true; }, 800);
            } else loader.hidden = true;
        }
        window.removeEventListener('keydown', onInput, true);
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('wheel', onInput, true);
        document.removeEventListener('visibilitychange', onVisibility);
        motion.removeEventListener('change', onMotion);
        notify();
        return true;
    }

    // Only the pre-paint bootstrap may authorize an intro. If it is absent or
    // already revealed, a late engine must never hide an already visible page.
    function start() {
        if (terminal() || status === 'playing') return false;
        if (motion.matches) { finish('reduced-motion'); return false; }
        if (document.hidden || !startup?.play()) { finish('startup-released'); return false; }
        status = 'playing';
        reason = '';
        startedAt = performance.now();
        window.clearTimeout(hideTimer);
        if (loader) { loader.hidden = false; loader.classList.remove('intro-loader--dissolving'); }
        body.classList.add('intro-active');
        updateClock();
        clockTimer = window.setInterval(updateClock, 50);
        finishTimer = window.setTimeout(() => finish('complete'), durationMs);
        watchdog = window.setTimeout(() => finish('watchdog'), durationMs + 1000);
        notify();
        return true;
    }

    function onInput(event) {
        finish(event.type === 'keydown' && event.key === 'Escape' ? 'escape' : 'interaction');
    }
    function onMotion() { if (motion.matches) finish('reduced-motion'); }
    function onVisibility() { if (document.hidden) finish('hidden'); }

    window.JazeIntro = Object.freeze({
        getSnapshot: snapshot,
        start,
        finish,
        fail: () => finish('engine-error'),
        subscribe(listener) {
            listeners.add(listener);
            try { listener(snapshot()); } catch (error) { console.warn('[Jaze intro] Scene listener failed:', error); }
            return () => listeners.delete(listener);
        }
    });

    if (body.dataset.intro !== 'true' || !loader) { finish('disabled'); return; }
    if (!startup) { finish('bootstrap-unavailable'); return; }
    const initialStartup = startup.getSnapshot();
    if (initialStartup.phase === 'revealed') { finish(initialStartup.reason); return; }
    if (document.hidden) { finish('hidden'); return; }

    unsubscribeStartup = startup.subscribe(state => {
        if (state.phase === 'revealed') finish(state.reason);
    });
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, { capture: true, passive: true });
    window.addEventListener('wheel', onInput, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', onMotion);
    observer = new MutationObserver(() => {
        if (status === 'playing' && !body.classList.contains('intro-active')) finish('external-reveal');
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
}());
