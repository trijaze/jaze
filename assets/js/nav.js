(function initSiteNavigation() {
    'use strict';

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
})();
