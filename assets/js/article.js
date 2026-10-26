(function initArticleTools() {
    'use strict';

    const RESET_DELAY_MS = 1800;

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
        const button = event.target.closest('[data-copy-code]');
        if (!button) return;
        const code = button.closest('[data-code-block]')?.querySelector('code');
        if (!code) return;

        const original = button.textContent;
        try {
            await copyText(code.textContent || '');
            button.textContent = 'Copied';
            button.setAttribute('aria-label', 'Code copied to clipboard');
        } catch {
            button.textContent = 'Copy failed';
            button.setAttribute('aria-label', 'Unable to copy code');
        }

        window.setTimeout(() => {
            button.textContent = original;
            button.removeAttribute('aria-label');
        }, RESET_DELAY_MS);
    });
})();
