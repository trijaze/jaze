(function initSiteShell() {
    'use strict';

    // Prevent browser from restoring scroll to lower sections (e.g. CVE table) on reload
    if ('scrollRestoration' in history) {
        try {
            history.scrollRestoration = 'manual';
        } catch (_) {}
    }
    if (!window.location.hash) window.scrollTo(0, 0);

    function initSiteNavigation() {
        const toggle = document.querySelector('[data-nav-toggle]');
        const menu = document.querySelector('[data-nav-menu]');
        if (!toggle || !menu) return;

        const mobileQuery = window.matchMedia('(max-width: 720px)');

        function setOpen(open) {
            const shouldOpen = Boolean(open) && mobileQuery.matches;
            toggle.setAttribute('aria-expanded', String(shouldOpen));
            toggle.setAttribute('aria-label', shouldOpen ? 'Close navigation menu' : 'Open navigation menu');
            menu.hidden = mobileQuery.matches ? !shouldOpen : false;
            menu.inert = mobileQuery.matches ? !shouldOpen : false;
        }

        toggle.addEventListener('click', () => {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        menu.addEventListener('click', event => {
            if (event.target.closest('a')) setOpen(false);
        });

        document.addEventListener('click', event => {
            if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) {
                setOpen(false);
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
                setOpen(false);
                toggle.focus();
            }
        });

        mobileQuery.addEventListener('change', () => setOpen(false));
        setOpen(false);
    }

    function initBackgroundBlurToggle() {
        const blurSwitch = document.getElementById('nav-blur-switch');
        if (!blurSwitch) return;

        const page = document.body.dataset.page;
        const isHome = page === 'profile' || window.location.pathname === '/' || window.location.pathname === '/index.html';
        const STORAGE_KEY = isHome ? 'jaze_bg_blur_home' : 'jaze_bg_blur_sub';
        const defaultEnabled = !isHome;
        const stateLabel = blurSwitch.querySelector('[data-blur-state]');

        function setBlurState(enabled, save) {
            if (enabled) {
                document.body.classList.add('bg-blur-active');
                blurSwitch.setAttribute('aria-checked', 'true');
                blurSwitch.classList.add('is-active');
                blurSwitch.setAttribute('title', 'Background blur: ON (Click to toggle raw matrix background, press B)');
                if (stateLabel) stateLabel.textContent = 'BLUR';
            } else {
                document.body.classList.remove('bg-blur-active');
                blurSwitch.setAttribute('aria-checked', 'false');
                blurSwitch.classList.remove('is-active');
                blurSwitch.setAttribute('title', 'Background blur: OFF (Click to toggle soft frosted background, press B)');
                if (stateLabel) stateLabel.textContent = 'BLUR';
            }

            if (save) {
                try {
                    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
                } catch (_) {}
            }
        }

        // Default state: blur switch is OFF on homepage, but ON on CVE/Blog pages
        let initialEnabled = defaultEnabled;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) {
                initialEnabled = stored === 'true';
            }
        } catch (_) {}

        setBlurState(initialEnabled, false);

        blurSwitch.addEventListener('click', () => {
            const isCurrentlyActive = document.body.classList.contains('bg-blur-active');
            setBlurState(!isCurrentlyActive, true);
        });

        // Keyboard shortcut: Press 'b' to toggle background blur (when not in an input)
        window.addEventListener('keydown', event => {
            if (
                (event.key === 'b' || event.key === 'B') &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !['input', 'textarea', 'select'].includes(document.activeElement?.tagName?.toLowerCase())
            ) {
                const isCurrentlyActive = document.body.classList.contains('bg-blur-active');
                setBlurState(!isCurrentlyActive, true);
            }
        });
    }

    
    function initGreenBrightnessToggle() {
        const btn = document.getElementById('nav-brightness-btn');
        if (!btn) return;

        const STORAGE_KEY = 'jaze_green_boost';

        function setBoostState(enabled, save) {
            if (enabled) {
                document.body.classList.add('green-boost-active');
                btn.setAttribute('aria-pressed', 'true');
                btn.classList.add('is-active');
                btn.setAttribute('title', 'Green brightness: 3x BOOST (Active, press L to reset)');
            } else {
                document.body.classList.remove('green-boost-active');
                btn.setAttribute('aria-pressed', 'false');
                btn.classList.remove('is-active');
                btn.setAttribute('title', 'Boost green brightness 3x (Press L)');
            }

            if (save) {
                try {
                    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
                } catch (_) {}
            }
        }

        let initialEnabled = false;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) {
                initialEnabled = stored === 'true';
            }
        } catch (_) {}

        setBoostState(initialEnabled, false);

        btn.addEventListener('click', () => {
            const isCurrentlyActive = document.body.classList.contains('green-boost-active');
            setBoostState(!isCurrentlyActive, true);
        });

        // Keyboard shortcut: Press 'l' or 'L' to toggle green brightness boost
        window.addEventListener('keydown', event => {
            if (
                (event.key === 'l' || event.key === 'L') &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !['input', 'textarea', 'select'].includes(document.activeElement?.tagName?.toLowerCase())
            ) {
                const isCurrentlyActive = document.body.classList.contains('green-boost-active');
                setBoostState(!isCurrentlyActive, true);
            }
        });
    }

    function initCryptoCopy() {
        const RESET_DELAY_MS = 2000;

        async function copyText(value) {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
                return;
            }

            const field = document.createElement('textarea');
            field.value = value;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.append(field);
            field.select();
            const copied = document.execCommand('copy');
            field.remove();
            if (!copied) throw new Error('Copy command failed.');
        }

        document.addEventListener('click', async event => {
            const button = event.target.closest('[data-copy-crypto]');
            if (!button) return;
            const address = button.getAttribute('data-copy-crypto') || '';
            if (!address) return;

            const textSpan = button.querySelector('.feed-me-copy-text') || button;
            const originalText = textSpan.textContent;

            try {
                await copyText(address);
                textSpan.textContent = 'Copied!';
                button.classList.add('is-copied');
                button.setAttribute('aria-label', 'Address copied to clipboard');
            } catch {
                textSpan.textContent = 'Failed';
                button.setAttribute('aria-label', 'Unable to copy address');
            }

            window.setTimeout(() => {
                textSpan.textContent = originalText;
                button.classList.remove('is-copied');
                button.removeAttribute('aria-label');
            }, RESET_DELAY_MS);
        });
    }

    function initFeedMeModal() {
        const dialog = document.getElementById('feed-me-dialog');
        if (!dialog) return;

        let isClosing = false;

        function openModal() {
            isClosing = false;
            dialog.classList.remove('is-closing');
            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        }

        function closeModalWithAnimation() {
            if (isClosing || !dialog.open) return;
            isClosing = true;
            dialog.classList.add('is-closing');

            const finishClose = () => {
                if (!isClosing) return;
                dialog.classList.remove('is-closing');
                isClosing = false;
                if (typeof dialog.close === 'function') {
                    dialog.close();
                } else {
                    dialog.removeAttribute('open');
                }
            };

            const surface = dialog.querySelector('.feed-me-dialog__surface');
            if (surface) {
                const onAnimationEnd = event => {
                    if (event.target === surface) {
                        surface.removeEventListener('animationend', onAnimationEnd);
                        finishClose();
                    }
                };
                surface.addEventListener('animationend', onAnimationEnd);
            }

            // Safety timeout fallback (180ms) in case animationend does not fire
            window.setTimeout(finishClose, 180);
        }

        // Intercept native Escape key on dialog to play smooth close animation
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            closeModalWithAnimation();
        });

        document.addEventListener('click', event => {
            const openTrigger = event.target.closest('[data-open-feed-me]');
            if (openTrigger) {
                event.preventDefault();
                openModal();
                return;
            }

            const closeTrigger = event.target.closest('[data-close-feed-me]');
            if (closeTrigger) {
                event.preventDefault();
                closeModalWithAnimation();
                return;
            }

            if (event.target === dialog) {
                closeModalWithAnimation();
            }
        });
    }

    initSiteNavigation();
    initBackgroundBlurToggle();
    initGreenBrightnessToggle();
    initCryptoCopy();
    initFeedMeModal();
})();
