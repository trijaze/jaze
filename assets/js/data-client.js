(function exposeJazeDataClient(root) {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 10000;

    async function fetchJson(resource, options = {}) {
        const controller = new AbortController();
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(resource, {
                cache: options.cache || 'default',
                headers: { Accept: 'application/json', ...(options.headers || {}) },
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`Request failed: HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timeoutId);
        }
    }

    root.JazeDataClient = Object.freeze({ fetchJson });
})(globalThis);
