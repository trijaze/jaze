(function initSpatialIntroSystem() {
    'use strict';

    const PI = Math.PI;
    const TAU = PI * 2;
    const SHADE_BYTES = new Uint8Array([32, 46, 58, 45, 61, 43, 42, 35, 37, 64]);
    const INTRO_DURATION_MS = 3000;
    const FIXED_PITCH = -0.26;

    const spatialBg = document.querySelector('[data-spatial-bg]');
    const webglCanvas = document.getElementById('spatial-webgl');
    const canvas2d = document.getElementById('spatial-canvas');
    const spatialOutput = document.querySelector('[data-spatial-output]');
    const starButton = document.getElementById('singularity-star');
    const starTooltip = document.querySelector('.singularity-star__tooltip') || document.getElementById('star-tooltip');
    const introLoader = document.getElementById('intro-loader');
    const loaderClock = document.querySelector('[data-loader-clock]');
    const loaderName = document.querySelector('[data-loader-name]');
    const loaderProgress = document.querySelector('[data-loader-progress]');
    const heroTitle = document.querySelector('.jaze-logo-line--main') || document.getElementById('hero-title');

    if (!spatialBg) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(pointer: fine)');

    // 4 Flagship 3D Volumetric Manifolds
    const CANDIDATE_MODELS = [
        { id: 'neovius', name: 'Neovius TPMS' },
        { id: 'gyroid', name: 'Gyroid Minimal Surface' },
        { id: 'lissajous', name: 'Lissajous 3D Quantum Orbit' },
        { id: 'superformula', name: 'Supershape 3D Crystal' }
    ];

    // Select via URL parameter (?model=neovius / gyroid / lissajous / superformula) or pick 1 randomly
    const urlParams = new URLSearchParams(window.location.search);
    const requestedModel = (
        urlParams.get('model') ||
        (window.location.hash.match(/model=([a-z0-9-]+)/i) || [])[1] ||
        ''
    ).toLowerCase();
    const matchedSpecimen = CANDIDATE_MODELS.find(m => m.id === requestedModel);
    const selectedSpecimen = matchedSpecimen || CANDIDATE_MODELS[Math.floor(Math.random() * CANDIDATE_MODELS.length)];
    let currentModelId = selectedSpecimen.id;

    if (loaderName) {
        loaderName.textContent = selectedSpecimen.name;
    }

    // Official 3D ASCII Profile Specification
    // Engine: WebGL2 ASCII with Canvas2D fallback
    // GPU Style: Surface particles
    // Density: Nano 2.2px (supersample 2)
    // Perspective States:
    //   Exterior (thu nhỏ): cameraZ 2.4, scale 1.0, surfaceFill 40% (0.40), color #148500 (20, 133, 0)
    //   Interior (phóng to): cameraZ 1.45, scale 1.25, surfaceFill 100% (1.00), color #24d700 (36, 215, 0)
    let activeEngine = 'webgl';
    let viewMode = 'exterior';

    let currentCameraZ = 2.4;
    let targetCameraZ = 2.4;
    let currentScaleMultiplier = 1.0;
    let targetScaleMultiplier = 1.0;
    let currentSurfaceFill = 0.40;
    let targetSurfaceFill = 0.40;

    let currentR = 20, currentG = 133, currentB = 0;
    let targetR = 20, targetG = 133, targetB = 0;

    let spinPhase = 0.55;
    let spinVelocity = 0.18;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let currentTiltX = 0;
    let currentTiltY = 0;

    let introFinished = false;
    let introStartTime = 0;
    let lastTime = 0;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const fontSize = 2.2; // Nano 2.2px
    const supersample = 2; // High-fidelity 2x supersampling
    let cellW = 1.35;
    let cellH = 2.0;
    let cols = 980;
    let rows = 500;
    let fitScaleX = 120;
    let cachedMaxProjX = 0.82;
    let cachedMaxProjY = 0.4865;
    let currentPixelShiftY = 0;
    let targetPixelShiftY = 0;

    let webglRenderer = null;

    // Fallback Canvas2D buffers & CPU geometry
    let ctx2d = null;
    let depthBuffer = null;
    let gridChars = null;
    let pointData = null;
    let pointCount = 0;
    const textDecoder = new TextDecoder();

    function clamp(val, min, max) {
        return Math.min(max, Math.max(min, val));
    }

    function normalizeVector(v) {
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    // Measure character metrics precisely
    function measureCellMetrics() {
        const measureCanvas = document.createElement('canvas');
        const mctx = measureCanvas.getContext('2d');
        if (mctx) {
            mctx.font = `bold ${fontSize.toFixed(2)}px "IBM Plex Mono", monospace`;
            const m = mctx.measureText('M');
            cellW = Math.max(1.15, m.width || fontSize * 0.60);
        } else {
            cellW = 1.35;
        }
        cellH = Math.round(cellW * 1.50 * 10) / 10;
        cols = Math.max(80, Math.floor(width / cellW));
        rows = Math.max(40, Math.floor(height / cellH));
    }

    // Geometry normalization for Canvas2D fallback
    function normalizeGeometry(points) {
        if (!points || !points.length) return [];
        const minB = [Infinity, Infinity, Infinity];
        const maxB = [-Infinity, -Infinity, -Infinity];
        points.forEach(p => {
            for (let axis = 0; axis < 3; axis++) {
                minB[axis] = Math.min(minB[axis], p[axis]);
                maxB[axis] = Math.max(maxB[axis], p[axis]);
            }
        });
        const center = minB.map((val, axis) => (val + maxB[axis]) / 2);
        const span = Math.max(...minB.map((val, axis) => maxB[axis] - val), 0.0001);
        const scale = 2.1 / span;

        return points.map(p => {
            const norm = normalizeVector(p.slice(3, 6).length === 3 ? p.slice(3, 6) : normalizeVector(p.slice(0, 3)));
            return [
                (p[0] - center[0]) * scale,
                (p[1] - center[1]) * scale,
                (p[2] - center[2]) * scale,
                norm[0], norm[1], norm[2]
            ];
        });
    }

    function sampleImplicit(field, resolution = 54, extent = PI * 0.94) {
        const n = resolution;
        const size = n + 1;
        const step = (extent * 2) / n;
        const min = -extent;
        const values = new Float32Array(size ** 3);
        const points = [];
        const index = (i, j, k) => (i * size + j) * size + k;
        const coord = i => min + i * step;

        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= n; j++) {
                for (let k = 0; k <= n; k++) {
                    values[index(i, j, k)] = field(coord(i), coord(j), coord(k));
                }
            }
        }

        function gradient(x, y, z) {
            const e = step * 0.18;
            const dx = field(x + e, y, z) - field(x - e, y, z);
            const dy = field(x, y + e, z) - field(x, y - e, z);
            const dz = field(x, y, z + e) - field(x, y - e, z);
            return normalizeVector([dx, dy, dz]);
        }

        function addCrossing(i, j, k, axis) {
            const delta = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
            const a = values[index(i, j, k)];
            const b = values[index(i + delta[0], j + delta[1], k + delta[2])];
            if ((a >= 0) === (b >= 0) || Math.abs(a - b) < 1e-9) return;
            const amount = a / (a - b);
            const x = coord(i) + delta[0] * step * amount;
            const y = coord(j) + delta[1] * step * amount;
            const z = coord(k) + delta[2] * step * amount;
            points.push([x, y, z, ...gradient(x, y, z)]);
        }

        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= n; j++) {
                for (let k = 0; k <= n; k++) {
                    if (i < n) addCrossing(i, j, k, 0);
                    if (j < n) addCrossing(i, j, k, 1);
                    if (k < n) addCrossing(i, j, k, 2);
                }
            }
        }

        return normalizeGeometry(points);
    }

    function sampleCurve(fn, range = [0, TAU], steps = 1200, radius = 0.09, ringSteps = 18) {
        const points = [];
        const dt = (range[1] - range[0]) / steps;
        for (let i = 0; i <= steps; i++) {
            const t = range[0] + dt * i;
            const center = fn(t);
            const before = fn(t - dt * 0.4);
            const after = fn(t + dt * 0.4);
            const tangent = normalizeVector([after[0] - before[0], after[1] - before[1], after[2] - before[2]]);
            const ref = Math.abs(tangent[1]) < 0.88 ? [0, 1, 0] : [1, 0, 0];
            const ax = tangent[1] * ref[2] - tangent[2] * ref[1];
            const ay = tangent[2] * ref[0] - tangent[0] * ref[2];
            const az = tangent[0] * ref[1] - tangent[1] * ref[0];
            const a = normalizeVector([ax, ay, az]);
            const bx = tangent[1] * a[2] - tangent[2] * a[1];
            const by = tangent[2] * a[0] - tangent[0] * a[2];
            const bz = tangent[0] * a[1] - tangent[1] * a[0];
            const b = normalizeVector([bx, by, bz]);
            for (let ring = 0; ring < ringSteps; ring++) {
                const angle = TAU * ring / ringSteps;
                const nx = a[0] * Math.cos(angle) + b[0] * Math.sin(angle);
                const ny = a[1] * Math.cos(angle) + b[1] * Math.sin(angle);
                const nz = a[2] * Math.cos(angle) + b[2] * Math.sin(angle);
                points.push([center[0] + nx * radius, center[1] + ny * radius, center[2] + nz * radius, nx, ny, nz]);
            }
        }
        return normalizeGeometry(points);
    }

    function radialSuperformula(angle, m, n1, n2, n3, a = 1, b = 1) {
        const first = Math.pow(Math.abs(Math.cos(m * angle / 4) / a), n2);
        const second = Math.pow(Math.abs(Math.sin(m * angle / 4) / b), n3);
        return Math.pow(first + second, -1 / n1);
    }

    function sampleSurface(fn, uRange, vRange, uSteps = 160, vSteps = 80) {
        const points = [];
        const du = (uRange[1] - uRange[0]) / uSteps;
        const dv = (vRange[1] - vRange[0]) / vSteps;
        for (let i = 0; i <= uSteps; i++) {
            const u = uRange[0] + du * i;
            for (let j = 0; j <= vSteps; j++) {
                const v = vRange[0] + dv * j;
                const pt = fn(u, v);
                const ptU = fn(u + du * 0.1, v);
                const ptV = fn(u, v + dv * 0.1);
                const ux = ptU[0] - pt[0], uy = ptU[1] - pt[1], uz = ptU[2] - pt[2];
                const vx = ptV[0] - pt[0], vy = ptV[1] - pt[1], vz = ptV[2] - pt[2];
                const nx = uy * vz - uz * vy;
                const ny = uz * vx - ux * vz;
                const nz = ux * vy - uy * vx;
                points.push([...pt, ...normalizeVector([nx, ny, nz])]);
            }
        }
        return normalizeGeometry(points);
    }

    // Generate fallback point cloud for any of the 4 models
    function generateFallbackModel(id) {
        let raw = [];
        if (id === 'gyroid') {
            raw = sampleImplicit((x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x), 54, PI * 0.94);
        } else if (id === 'lissajous') {
            raw = sampleCurve(t => [Math.sin(3 * t + PI / 2), Math.sin(4 * t), Math.sin(5 * t)], [0, TAU], 1200, 0.09, 20);
        } else if (id === 'superformula') {
            raw = sampleSurface((u, v) => {
                const r1 = radialSuperformula(u, 6, 0.8, 1.0, 1.0);
                const r2 = radialSuperformula(v, 4, 0.8, 1.0, 1.0);
                return [r1 * Math.cos(u) * r2 * Math.cos(v), r1 * Math.sin(u) * r2 * Math.cos(v), r2 * Math.sin(v)];
            }, [-PI, PI], [-PI / 2, PI / 2], 160, 80);
        } else {
            raw = sampleImplicit((x, y, z) => 3 * (Math.cos(x) + Math.cos(y) + Math.cos(z)) + 4 * Math.cos(x) * Math.cos(y) * Math.cos(z), 54, PI * 0.94);
        }
        pointCount = raw.length;
        pointData = new Float32Array(pointCount * 6);
        for (let i = 0; i < pointCount; i++) {
            const off = i * 6;
            const p = raw[i];
            pointData[off] = p[0];
            pointData[off + 1] = p[1];
            pointData[off + 2] = p[2];
            pointData[off + 3] = p[3];
            pointData[off + 4] = p[4];
            pointData[off + 5] = p[5];
        }
        const env = computeEnvelope(pointData, pointCount);
        cachedMaxProjX = env.maxProjX || 0.82;
        cachedMaxProjY = env.maxProjY || 0.4865;
        updateScaleCalibration();
    }

    function computeEnvelope(pointsFlat, count) {
        const camZ = 2.4;
        const ySteps = 36;
        const pitches = [FIXED_PITCH - 0.10, FIXED_PITCH, FIXED_PITCH + 0.10];
        let maxProjX = 0.0001;
        let maxProjY = 0.0001;

        for (let pIdx = 0; pIdx < pitches.length; pIdx++) {
            const pitch = pitches[pIdx];
            const cosX = Math.cos(pitch), sinX = Math.sin(pitch);
            for (let s = 0; s < ySteps; s++) {
                const theta = (s * TAU) / ySteps;
                const cosY = Math.cos(theta), sinY = Math.sin(theta);
                for (let off = 0; off < count * 6; off += 6) {
                    const x = pointsFlat[off];
                    const y = pointsFlat[off + 1];
                    const z = pointsFlat[off + 2];
                    const x1 = x * cosY + z * sinY;
                    const z1 = -x * sinY + z * cosY;
                    const y2 = y * cosX - z1 * sinX;
                    const z2 = y * sinX + z1 * cosX;
                    const dist = camZ - z2;
                    if (dist > 0.05) {
                        const projX = Math.abs(x1) / dist;
                        if (projX > maxProjX) maxProjX = projX;
                        const projY = y2 / dist;
                        if (projY > maxProjY) maxProjY = projY;
                    }
                }
            }
        }
        return { maxProjX, maxProjY };
    }

    function updateScaleCalibration() {
        const halfCols = (cols - 1) / 2;
        const FIT_TARGET = 0.96;
        fitScaleX = (halfCols * FIT_TARGET) / (cachedMaxProjX || 0.001);
    }

    function ensureCanvas2dBuffers() {
        if (!canvas2d) return;
        const total = cols * rows;
        if (!gridChars || gridChars.length !== total) {
            gridChars = new Uint8Array(total);
            depthBuffer = new Float32Array(total);
        }
        canvas2d.width = Math.floor(width * dpr);
        canvas2d.height = Math.floor(height * dpr);
        canvas2d.style.width = `${width}px`;
        canvas2d.style.height = `${height}px`;
        ctx2d = canvas2d.getContext('2d');
    }

    // Engine Selection and Initialization
    function initEngine() {
        if (webglCanvas && window.JazeAsciiWebGL) {
            try {
                webglRenderer = new window.JazeAsciiWebGL(webglCanvas, {
                    implicitResolution: 40,
                    particleCount: 80000
                });
                webglRenderer.setModel(currentModelId);
                webglRenderer.resize({
                    width,
                    height,
                    dpr,
                    cellWidth: cellW,
                    cellHeight: cellH,
                    supersample
                });
                activeEngine = 'webgl';
                webglCanvas.style.display = 'block';
                if (canvas2d) canvas2d.style.display = 'none';
                if (spatialOutput) spatialOutput.style.display = 'none';
                return;
            } catch (err) {
                console.warn('[Jaze 3D] WebGL2 failed, falling back to Canvas2D:', err);
            }
        }

        // Fallback to Canvas2D
        activeEngine = 'canvas';
        if (webglCanvas) webglCanvas.style.display = 'none';
        if (canvas2d) {
            canvas2d.style.display = 'block';
            if (!pointData) generateFallbackModel(currentModelId);
            ensureCanvas2dBuffers();
        }
        if (spatialOutput) spatialOutput.style.display = 'none';
    }

    // Switch Model Dynamically
    function switchModel(modelId) {
        const found = CANDIDATE_MODELS.find(m => m.id === modelId);
        if (!found) return;
        currentModelId = found.id;
        if (loaderName) loaderName.textContent = found.name;
        if (activeEngine === 'webgl' && webglRenderer && !webglRenderer.getStats().lost) {
            webglRenderer.setModel(currentModelId);
        } else if (activeEngine === 'canvas') {
            generateFallbackModel(currentModelId);
            ensureCanvas2dBuffers();
        }
    }
    window.switchModel = switchModel;

    // Resize Handler
    function handleResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);

        measureCellMetrics();
        updateScaleCalibration();
        updateStarPosition();

        if (activeEngine === 'webgl' && webglRenderer && !webglRenderer.getStats().lost) {
            webglRenderer.resize({
                width,
                height,
                dpr,
                cellWidth: cellW,
                cellHeight: cellH,
                supersample
            });
        } else if (activeEngine === 'canvas') {
            ensureCanvas2dBuffers();
        }
    }

    // Singularity Star Positioning: Anchored exactly to the center of JAZE main text
    function updateStarPosition() {
        if (!starButton) return;

        if (!introFinished) {
            starButton.style.position = 'fixed';
            starButton.style.top = '50%';
            starButton.style.left = '50%';
            starButton.style.transform = 'translate(-50%, -50%)';
            starButton.style.zIndex = '100000';
            return;
        }

        const title = heroTitle || document.querySelector('.jaze-logo-line--main') || document.querySelector('.home-hero h1');
        if (title) {
            const bodyRect = document.body.getBoundingClientRect();
            const rect = title.getBoundingClientRect();
            const centerX = Math.round(rect.left - bodyRect.left + rect.width / 2);
            const centerY = Math.round(rect.top - bodyRect.top + rect.height / 2);
            starButton.style.position = 'absolute';
            starButton.style.top = `${centerY}px`;
            starButton.style.left = `${centerX}px`;
            starButton.style.transform = 'translate(-50%, -50%)';
            starButton.style.zIndex = '50';
        }
    }

    // Perspective Toggle (Zoom In <-> Zoom Out)
    function togglePerspective() {
        if (viewMode === 'interior') {
            // Switch to Exterior (Overview / Thu nhỏ)
            viewMode = 'exterior';
            targetCameraZ = 2.4;
            targetScaleMultiplier = 1.0;
            targetSurfaceFill = 0.40; // 40% surface fill in overview
            targetR = 20; targetG = 133; targetB = 0; // Normal tone #148500

            if (starTooltip) starTooltip.textContent = 'Dive Inside';
            if (starButton) {
                starButton.setAttribute('aria-label', 'View 3D interior (Dive inside)');
                starButton.setAttribute('title', 'Click: Dive inside model');
            }
            spatialBg.classList.remove('site-spatial-bg--interior');
            spatialBg.classList.add('site-spatial-bg--exterior');
        } else {
            // Switch to Interior (Zoom In / Phóng to)
            viewMode = 'interior';
            targetCameraZ = 1.45;
            targetScaleMultiplier = 1.25;
            targetSurfaceFill = 1.00; // 100% surface fill in zoom in
            targetR = 36; targetG = 215; targetB = 0; // +2 tones brighter #24d700

            if (starTooltip) starTooltip.textContent = 'Zoom Out';
            if (starButton) {
                starButton.setAttribute('aria-label', 'View 3D exterior overview');
                starButton.setAttribute('title', 'Click: Zoom out to fit screen width');
            }
            spatialBg.classList.remove('site-spatial-bg--exterior');
            spatialBg.classList.add('site-spatial-bg--interior');
        }

        if (reducedMotion.matches) {
            currentCameraZ = targetCameraZ;
            currentScaleMultiplier = targetScaleMultiplier;
            currentSurfaceFill = targetSurfaceFill;
            currentR = targetR; currentG = targetG; currentB = targetB;
            currentPixelShiftY = targetPixelShiftY;
        }
    }

    // Intro Completion Choreography
    function completeIntro() {
        if (introFinished) return;
        introFinished = true;

        document.body.classList.remove('intro-active');
        spatialBg.classList.remove('site-spatial-bg--intro');

        if (introLoader) {
            introLoader.classList.add('intro-loader--dissolving');
            window.setTimeout(() => {
                introLoader.classList.add('intro-loader--hidden');
            }, 800);
        }

        updateStarPosition();

        if (starButton) {
            starButton.classList.add('singularity-star--interactive');
            starButton.setAttribute('aria-label', 'View 3D interior (Dive inside)');
            starButton.setAttribute('title', 'Click: Dive inside model');
            if (starTooltip) {
                starTooltip.textContent = 'Dive Inside';
            }
        }
    }

    // Event Listeners
    if (starButton) {
        starButton.addEventListener('click', togglePerspective);
    }

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !introFinished) {
            completeIntro();
        }
    });

    window.addEventListener('pointermove', event => {
        if (!introFinished || !finePointer.matches || reducedMotion.matches) return;
        const nx = (event.clientX / window.innerWidth) * 2 - 1;
        const ny = (event.clientY / window.innerHeight) * 2 - 1;
        targetTiltX = clamp(ny * 0.14, -0.16, 0.16);
        targetTiltY = clamp(nx * 0.18, -0.20, 0.20);
    }, { passive: true });

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('load', updateStarPosition, { passive: true });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            measureCellMetrics();
            updateScaleCalibration();
            updateStarPosition();
            if (webglRenderer) webglRenderer.refreshAtlas();
        });
    }

    if (webglCanvas) {
        webglCanvas.addEventListener('webglcontextlost', () => {
            activeEngine = 'canvas';
            if (webglCanvas) webglCanvas.style.display = 'none';
            if (canvas2d) {
                canvas2d.style.display = 'block';
                if (!pointData) generateFallbackModel(currentModelId);
                ensureCanvas2dBuffers();
            }
        });
        webglCanvas.addEventListener('webglcontextrestored', () => {
            try {
                if (webglRenderer) webglRenderer.destroy();
                initEngine();
            } catch (e) {
                console.warn('[Jaze 3D] Restore failed:', e);
            }
        });
    }

    // Canvas2D Fallback Rendering (Row batching)
    const light = normalizeVector([-0.35, 0.72, 0.6]);

    function pointSelected(index, fill) {
        if (fill >= 1) return true;
        if (fill <= 0) return false;
        let seed = Math.imul(index + 1, 374761393) >>> 0;
        seed = Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0;
        seed = (seed ^ (seed >>> 16)) >>> 0;
        return (seed & 65535) / 65536 < fill;
    }

    function renderCanvasFallback(rotX, rotY, rotZ, camZ, activeScaleMult, fill, rgb, pixelShiftY = 0) {
        if (!ctx2d || !gridChars || !pointData) return;
        depthBuffer.fill(-Infinity);
        gridChars.fill(32);

        let minActiveRow = rows, maxActiveRow = -1;
        const halfCols = (cols - 1) / 2;
        const halfRows = (rows - 1) / 2;
        const scaleX = fitScaleX * activeScaleMult;
        const scaleY = scaleX * (cellW / cellH);

        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
        const nearClipMin = 0.05;

        for (let i = 0; i < pointCount; i++) {
            if (!pointSelected(i, fill)) continue;
            const off = i * 6;
            const x = pointData[off], y = pointData[off + 1], z = pointData[off + 2];
            const nx = pointData[off + 3], ny = pointData[off + 4], nz = pointData[off + 5];

            const x1 = x * cosY + z * sinY;
            const z1 = -x * sinY + z * cosY;
            const nx1 = nx * cosY + nz * sinY;
            const nz1 = -nx * sinY + nz * cosY;

            const y2 = y * cosX - z1 * sinX;
            const z2 = y * sinX + z1 * cosX;
            const ny2 = ny * cosX - nz1 * sinX;
            const nz2 = ny * sinX + nz1 * cosX;

            const x3 = x1 * cosZ - y2 * sinZ;
            const y3 = x1 * sinZ + y2 * cosZ;
            const nx3 = nx1 * cosZ - ny2 * sinZ;
            const ny3 = nx1 * sinZ + ny2 * cosZ;

            const dist = camZ - z2;
            if (dist <= nearClipMin) continue;

            const invDist = 1 / dist;
            const scX = Math.round(halfCols + x3 * invDist * scaleX);
            const scY = Math.round(halfRows - y3 * invDist * scaleY + (pixelShiftY / cellH));

            if (scX < 0 || scX >= cols || scY < 0 || scY >= rows) continue;
            const idx = scY * cols + scX;

            if (z2 <= depthBuffer[idx]) continue;
            depthBuffer[idx] = z2;

            if (scY < minActiveRow) minActiveRow = scY;
            if (scY > maxActiveRow) maxActiveRow = scY;

            const diffuse = Math.abs(nx3 * light[0] + ny3 * light[1] + nz3 * light[2]);
            const depthFactor = clamp((z2 + 1.2) / 2.4, 0, 1);
            const brightness = clamp(0.12 + diffuse * 0.68 + depthFactor * 0.20, 0, 1);

            const shadeIdx = Math.min(SHADE_BYTES.length - 1, Math.max(0, Math.floor(brightness * SHADE_BYTES.length)));
            gridChars[idx] = SHADE_BYTES[shadeIdx];
        }

        ctx2d.save();
        ctx2d.scale(dpr, dpr);
        ctx2d.clearRect(0, 0, width, height);
        ctx2d.font = `bold ${fontSize.toFixed(2)}px "IBM Plex Mono", monospace`;
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'top';
        ctx2d.fillStyle = `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;

        if (minActiveRow <= maxActiveRow) {
            for (let r = minActiveRow; r <= maxActiveRow; r++) {
                const start = r * cols;
                const end = start + cols;
                const rowLine = textDecoder.decode(gridChars.subarray(start, end));
                ctx2d.fillText(rowLine, 0, Math.round(r * cellH));
            }
        }
        ctx2d.restore();
    }

    // Main 60 FPS Animation Loop
    function tick(timestamp) {
        window.requestAnimationFrame(tick);
        if (!introStartTime) introStartTime = timestamp;
        const elapsed = timestamp - introStartTime;
        const dt = lastTime ? clamp((timestamp - lastTime) / 1000, 0, 0.05) : 0.016;
        lastTime = timestamp;

        // Intro Phase (0s - 3s)
        if (!introFinished) {
            const progress = clamp(elapsed / INTRO_DURATION_MS, 0, 1);
            const remaining = Math.max(0, (INTRO_DURATION_MS - elapsed) / 1000);

            if (loaderClock) {
                const secs = String(Math.floor(remaining)).padStart(2, '0');
                const ms = String(Math.floor((remaining % 1) * 100)).padStart(2, '0');
                loaderClock.textContent = `00:${secs}.${ms}`;
            }

            if (loaderProgress) {
                loaderProgress.style.width = `${(progress * 100).toFixed(1)}%`;
            }

            // Smooth intro spin choreography
            if (progress < 0.60) {
                spinVelocity = 0.52 + progress * 0.45;
            } else if (progress < 0.85) {
                const norm = (progress - 0.60) / 0.25;
                spinVelocity = 0.79 - norm * 0.55;
            } else {
                spinVelocity = 0.24 - (progress - 0.85) * 0.4;
            }

            if (elapsed >= INTRO_DURATION_MS) {
                completeIntro();
            }
        } else {
            // Post-intro ambient drift
            const targetSpeed = 0.18;
            spinVelocity += (targetSpeed - spinVelocity) * (1 - Math.exp(-3 * dt));
        }

        // Smooth Exponential Damping for Camera, Scale, Surface Fill, and Color
        const cameraBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-5 * dt);
        currentCameraZ += (targetCameraZ - currentCameraZ) * cameraBlend;
        currentScaleMultiplier += (targetScaleMultiplier - currentScaleMultiplier) * cameraBlend;
        currentSurfaceFill += (targetSurfaceFill - currentSurfaceFill) * cameraBlend;

        // Vertical Alignment Calculation:
        // Loading screen (!introFinished): Centered horizontally & vertically across viewport (shift = 0)
        // Post-intro Exterior (thu nhỏ): Highest point sits exactly 50px below the bottom of nav
        // Post-intro Interior (phóng to): Centered for immersive inspection (shift = 0)
        if (!introFinished) {
            targetPixelShiftY = 0;
        } else if (viewMode === 'exterior') {
            const navEl = document.querySelector('.site-header') || document.querySelector('.site-nav');
            const navBottom = navEl ? (navEl.getBoundingClientRect().bottom || navEl.offsetHeight || 72) : 72;
            const focal = fitScaleX * cellW * currentScaleMultiplier;
            const topSpanPx = cachedMaxProjY * focal;
            const targetCenterY = navBottom + 50 + topSpanPx;
            targetPixelShiftY = targetCenterY - (height / 2);
        } else {
            targetPixelShiftY = 0;
        }

        currentPixelShiftY += (targetPixelShiftY - currentPixelShiftY) * cameraBlend;
        const ndcOffsetY = height > 0 ? (-2.0 * currentPixelShiftY / height) : 0;

        currentR += (targetR - currentR) * (1 - Math.exp(-4 * dt));
        currentG += (targetG - currentG) * (1 - Math.exp(-4 * dt));
        currentB += (targetB - currentB) * (1 - Math.exp(-4 * dt));

        currentTiltX += (targetTiltX - currentTiltX) * (1 - Math.exp(-6 * dt));
        currentTiltY += (targetTiltY - currentTiltY) * (1 - Math.exp(-6 * dt));

        if (!reducedMotion.matches) {
            spinPhase += spinVelocity * dt;
        }

        const rotY = spinPhase;
        const rotX = FIXED_PITCH + currentTiltX;
        const rotZ = currentTiltY * 0.12;

        if (activeEngine === 'webgl' && webglRenderer && !webglRenderer.getStats().lost) {
            webglRenderer.render({
                rotX,
                rotY,
                rotZ,
                cameraZ: currentCameraZ,
                scaleMultiplier: currentScaleMultiplier,
                fitScaleX,
                color: [currentR, currentG, currentB],
                surfaceFill: currentSurfaceFill,
                renderStyle: 'particles',
                offsetY: ndcOffsetY
            });
        } else if (activeEngine === 'canvas' && ctx2d) {
            renderCanvasFallback(
                rotX,
                rotY,
                rotZ,
                currentCameraZ,
                currentScaleMultiplier,
                currentSurfaceFill,
                [currentR, currentG, currentB],
                currentPixelShiftY
            );
        }
    }

    // Kinetic 3-Tier JAZE Logo Sub-Lines Engine (Calligraphy font mutation)
    function initHeroLogoAnimation() {
        const topChars = Array.from(document.querySelectorAll('[data-logo-sub="top"] .jaze-char'));
        const bottomChars = Array.from(document.querySelectorAll('[data-logo-sub="bottom"] .jaze-char'));
        if (!topChars.length && !bottomChars.length) return;

        const SCRIPT_FONTS = [
            "'Alex Brush', cursive",
            "'Italianno', cursive",
            "'Luxurious Script', cursive"
        ];

        const SCRIPT_GLYPHS = {
            j: ['J'],
            a: ['A'],
            z: ['Z'],
            e: ['E']
        };

        function getNextFont(currentFont) {
            const cleanCurrent = (currentFont || '').toLowerCase();
            const pool = SCRIPT_FONTS.filter(f => {
                const name = f.split(',')[0].replace(/['"]/g, '').toLowerCase();
                return !cleanCurrent.includes(name);
            });
            if (pool.length > 0) {
                return pool[Math.floor(Math.random() * pool.length)];
            }
            return SCRIPT_FONTS[Math.floor(Math.random() * SCRIPT_FONTS.length)];
        }

        function mutateChar(charEl) {
            if (!charEl) return;
            const charType = charEl.getAttribute('data-char') || 'j';
            const glyphs = SCRIPT_GLYPHS[charType] || ['J'];
            const nextGlyph = glyphs[Math.floor(Math.random() * glyphs.length)];
            const nextFont = getNextFont(charEl.style.fontFamily);

            charEl.textContent = nextGlyph;
            charEl.style.fontFamily = nextFont;

            if (nextFont.includes('Italianno')) {
                charEl.style.fontSize = '1.35em';
            } else if (nextFont.includes('Luxurious Script')) {
                charEl.style.fontSize = '1.75em';
            } else {
                charEl.style.fontSize = '1.15em';
            }
        }

        topChars.concat(bottomChars).forEach((charEl, idx) => {
            const initialFont = SCRIPT_FONTS[idx % SCRIPT_FONTS.length];
            charEl.style.fontFamily = initialFont;
            if (initialFont.includes('Italianno')) {
                charEl.style.fontSize = '1.35em';
            } else if (initialFont.includes('Luxurious Script')) {
                charEl.style.fontSize = '1.75em';
            } else {
                charEl.style.fontSize = '1.15em';
            }
        });

        if (reducedMotion.matches) return;

        let nextTarget = 'top';
        let lastSlotIndex = -1;

        function tickSingleMutation() {
            const targetList = nextTarget === 'top' ? topChars : bottomChars;
            nextTarget = nextTarget === 'top' ? 'bottom' : 'top';
            if (!targetList.length) return;

            let slotIndex = Math.floor(Math.random() * targetList.length);
            if (slotIndex === lastSlotIndex && targetList.length > 1) {
                slotIndex = (slotIndex + 1) % targetList.length;
            }
            lastSlotIndex = slotIndex;

            mutateChar(targetList[slotIndex]);
        }

        window.setInterval(tickSingleMutation, 400);
    }

    // Expose control API for testing / debugging
    window.jaze3d = Object.freeze({
        getModel: () => currentModelId,
        getModels: () => CANDIDATE_MODELS.map(m => m.id),
        switchModel,
        togglePerspective,
        getViewMode: () => viewMode,
        getRenderer: () => webglRenderer,
        getLayout: () => ({
            currentPixelShiftY,
            targetPixelShiftY,
            topSpanPx: cachedMaxProjY * fitScaleX * cellW * currentScaleMultiplier,
            cachedMaxProjY,
            introFinished
        })
    });

    // Initialize System in sequence
    measureCellMetrics();
    updateScaleCalibration();
    initEngine();
    updateStarPosition();
    initHeroLogoAnimation();

    window.requestAnimationFrame(tick);
}());
