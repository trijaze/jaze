(function initAsciiHero() {
    'use strict';

    const root = document.querySelector('[data-ascii-hero]');
    const output = root?.querySelector('[data-ascii-output]');
    const toggle = root?.querySelector('[data-ascii-toggle]');
    const status = root?.querySelector('[data-ascii-status]');
    if (!root || !output || !toggle) return;

    const FRAME_INTERVAL_MS = 50;
    const BASE_SPIN_SPEED = 0.16;
    const MAX_TILT = 0.2;
    const SPRING = 22;
    const DAMPING = 9;
    const SHADES = ' .:-=+*#@';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compactViewport = window.matchMedia('(max-width: 63.99rem)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const geometry = createMobiusGeometry(280, 56);

    const motion = {
        pointerX: 0,
        pointerY: 0,
        pointerInside: false,
        tiltX: 0,
        tiltY: 0,
        velocityX: 0,
        velocityY: 0,
        spinPhase: 0.62,
        spinSpeed: BASE_SPIN_SPEED
    };

    let pointerBounds = null;
    let manuallyPaused = false;
    let inViewport = true;
    let timeoutId = 0;
    let frameId = 0;
    let lastFrameTime = 0;

    function createMobiusGeometry(uSteps, vSteps) {
        const points = [];
        const epsilon = 0.002;

        function pointAt(u, v) {
            const radius = 1.35;
            const ring = radius + v * Math.cos(u / 2);
            return {
                x: ring * Math.cos(u),
                y: ring * Math.sin(u),
                z: v * Math.sin(u / 2)
            };
        }

        function subtract(a, b) {
            return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
        }

        function normalAt(u, v) {
            const tangentU = subtract(pointAt(u + epsilon, v), pointAt(u - epsilon, v));
            const tangentV = subtract(pointAt(u, v + epsilon), pointAt(u, v - epsilon));
            const normal = {
                x: tangentU.y * tangentV.z - tangentU.z * tangentV.y,
                y: tangentU.z * tangentV.x - tangentU.x * tangentV.z,
                z: tangentU.x * tangentV.y - tangentU.y * tangentV.x
            };
            const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
            return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
        }

        for (let uIndex = 0; uIndex < uSteps; uIndex += 1) {
            const u = (uIndex / uSteps) * Math.PI * 2;
            for (let vIndex = 0; vIndex < vSteps; vIndex += 1) {
                const v = -0.42 + (vIndex / (vSteps - 1)) * 0.84;
                points.push({ ...pointAt(u, v), normal: normalAt(u, v) });
            }
        }
        return points;
    }

    function rotate(point, xRotation, yRotation) {
        const cosX = Math.cos(xRotation);
        const sinX = Math.sin(xRotation);
        const cosY = Math.cos(yRotation);
        const sinY = Math.sin(yRotation);
        const y = point.y * cosX - point.z * sinX;
        const zAfterX = point.y * sinX + point.z * cosX;
        return {
            x: point.x * cosY + zAfterX * sinY,
            y,
            z: -point.x * sinY + zAfterX * cosY
        };
    }

    function attentionAt(column, row, columns, rows) {
        if (!motion.pointerInside) return 0;
        const normalizedX = (column / Math.max(columns - 1, 1)) * 2 - 1;
        const normalizedY = (row / Math.max(rows - 1, 1)) * 2 - 1;
        const distance = Math.hypot(normalizedX - motion.pointerX, normalizedY - motion.pointerY);
        return Math.max(0, 1 - distance / 0.65);
    }

    function renderFrame() {
        const columns = 168;
        const rows = 76;
        const cells = new Array(columns * rows).fill(' ');
        const depth = new Float32Array(columns * rows);
        const xRotation = -0.36 + motion.tiltX;
        const yRotation = motion.spinPhase + motion.tiltY;

        for (const point of geometry) {
            const projected = rotate(point, xRotation, yRotation);
            const normal = rotate(point.normal, xRotation, yRotation);
            const inverseDepth = 1 / (projected.z + 4.2);
            const column = Math.round(columns / 2 + projected.x * inverseDepth * 136);
            const row = Math.round(rows / 2 - projected.y * inverseDepth * 136 * 0.75);
            if (column < 0 || column >= columns || row < 0 || row >= rows) continue;

            const index = column + row * columns;
            if (inverseDepth <= depth[index]) continue;
            depth[index] = inverseDepth;
            const luminance = Math.max(0, normal.x * -0.3 + normal.y * 0.45 + normal.z * -0.84);
            const densityBoost = attentionAt(column, row, columns, rows) * 1.5;
            const shadeIndex = Math.min(
                SHADES.length - 1,
                Math.floor(luminance * SHADES.length + densityBoost)
            );
            cells[index] = SHADES[shadeIndex];
        }

        const lines = [];
        for (let row = 0; row < rows; row += 1) {
            lines.push(cells.slice(row * columns, (row + 1) * columns).join('').trimEnd());
        }
        output.textContent = lines.join('\n');
    }

    function canAnimate() {
        return !manuallyPaused
            && !document.hidden
            && inViewport
            && !reducedMotion.matches
            && !compactViewport.matches;
    }

    function stepMotion(elapsedSeconds) {
        const delta = Math.min(Math.max(elapsedSeconds, 0), 0.05);
        const targetX = motion.pointerInside ? -motion.pointerY * MAX_TILT : 0;
        const targetY = motion.pointerInside ? motion.pointerX * MAX_TILT : 0;

        motion.velocityX += (SPRING * (targetX - motion.tiltX) - DAMPING * motion.velocityX) * delta;
        motion.velocityY += (SPRING * (targetY - motion.tiltY) - DAMPING * motion.velocityY) * delta;
        motion.tiltX += motion.velocityX * delta;
        motion.tiltY += motion.velocityY * delta;

        const radius = Math.min(1, Math.hypot(motion.pointerX, motion.pointerY));
        const desiredSpeed = motion.pointerInside
            ? BASE_SPIN_SPEED * (0.12 + 0.88 * radius)
            : BASE_SPIN_SPEED;
        const blend = 1 - Math.exp(-3 * delta);
        motion.spinSpeed += (desiredSpeed - motion.spinSpeed) * blend;
        motion.spinPhase += motion.spinSpeed * delta;
    }

    function stopLoop() {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (frameId) window.cancelAnimationFrame(frameId);
        timeoutId = 0;
        frameId = 0;
        lastFrameTime = 0;
    }

    function scheduleNextFrame() {
        if (!canAnimate() || timeoutId || frameId) return;
        timeoutId = window.setTimeout(() => {
            timeoutId = 0;
            frameId = window.requestAnimationFrame(animate);
        }, FRAME_INTERVAL_MS);
    }

    function animate(timestamp) {
        frameId = 0;
        if (!canAnimate()) {
            stopLoop();
            return;
        }

        const elapsedSeconds = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0;
        lastFrameTime = timestamp;
        stepMotion(elapsedSeconds);
        renderFrame();
        scheduleNextFrame();
    }

    function updateControl() {
        const animationAvailable = !reducedMotion.matches && !compactViewport.matches;
        toggle.hidden = !animationAvailable;
        toggle.setAttribute('aria-pressed', String(manuallyPaused));
        toggle.textContent = manuallyPaused ? 'Play motion' : 'Pause motion';
    }

    function resetInteraction() {
        motion.pointerInside = false;
        pointerBounds = null;
    }

    function refreshMotion() {
        stopLoop();
        if (reducedMotion.matches || compactViewport.matches || !finePointer.matches) resetInteraction();
        updateControl();
        renderFrame();
        scheduleNextFrame();
    }

    function updatePointer(event) {
        if (!pointerBounds?.width || !pointerBounds?.height) return;
        motion.pointerX = Math.max(-1, Math.min(1,
            ((event.clientX - pointerBounds.left) / pointerBounds.width) * 2 - 1
        ));
        motion.pointerY = Math.max(-1, Math.min(1,
            ((event.clientY - pointerBounds.top) / pointerBounds.height) * 2 - 1
        ));
    }

    toggle.addEventListener('click', () => {
        manuallyPaused = !manuallyPaused;
        updateControl();
        if (status) status.textContent = manuallyPaused ? 'ASCII motion paused.' : 'ASCII motion playing.';
        if (manuallyPaused) stopLoop();
        else scheduleNextFrame();
    });

    root.addEventListener('pointerenter', event => {
        if (!finePointer.matches || reducedMotion.matches || compactViewport.matches) return;
        pointerBounds = root.getBoundingClientRect();
        motion.pointerInside = true;
        updatePointer(event);
    }, { passive: true });

    root.addEventListener('pointermove', event => {
        if (!motion.pointerInside || !canAnimate()) return;
        updatePointer(event);
    }, { passive: true });

    root.addEventListener('pointerleave', resetInteraction, { passive: true });

    document.addEventListener('visibilitychange', refreshMotion);
    reducedMotion.addEventListener('change', refreshMotion);
    compactViewport.addEventListener('change', refreshMotion);
    finePointer.addEventListener('change', refreshMotion);

    if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => { pointerBounds = null; });
        resizeObserver.observe(root);
    }

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(entries => {
            inViewport = Boolean(entries[0]?.isIntersecting);
            refreshMotion();
        }, { threshold: 0.05 });
        observer.observe(root);
    }

    refreshMotion();
})();
