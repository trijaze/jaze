(function initSpatialIntroSystem() {
    'use strict';

    const PI = Math.PI;
    const TAU = PI * 2;
    const SHADE_RAMP = ' .:-=+*#%@';
    const INTRO_DURATION_MS = 3000;
    const FIXED_PITCH = -0.26; // Fixed downward pitch around X for optimal 3D topology visibility

    const spatialBg = document.querySelector('[data-spatial-bg]');
    const spatialOutput = document.querySelector('[data-spatial-output]');
    const starButton = document.getElementById('singularity-star');
    const introLoader = document.getElementById('intro-loader');
    if (!spatialBg || !spatialOutput) return;

    const loaderClock = document.querySelector('[data-loader-clock]');
    const loaderName = document.querySelector('[data-loader-name]');
    const loaderProgress = document.querySelector('[data-loader-progress]');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Vector helpers
    function normalizeVector(vector) {
        const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
        return [vector[0] / length, vector[1] / length, vector[2] / length];
    }

    function subtract(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function clamp(val, min, max) {
        return Math.min(max, Math.max(min, val));
    }

    function isFinitePoint(point) {
        return point.length >= 3 && point.every(Number.isFinite);
    }

    function normalizeGeometry(points) {
        const valid = points.filter(p => p && isFinitePoint(p.slice(0, 3)));
        if (!valid.length) return [];
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        valid.forEach(p => {
            for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], p[axis]);
                max[axis] = Math.max(max[axis], p[axis]);
            }
        });
        const center = min.map((val, axis) => (val + max[axis]) / 2);
        const span = Math.max(...min.map((val, axis) => max[axis] - val), 0.0001);
        const scale = 2.1 / span;

        return valid.map(p => {
            const normal = normalizeVector(p.slice(3, 6).length === 3
                ? p.slice(3, 6)
                : normalizeVector(p.slice(0, 3)));
            return [
                (p[0] - center[0]) * scale,
                (p[1] - center[1]) * scale,
                (p[2] - center[2]) * scale,
                normal[0], normal[1], normal[2]
            ];
        });
    }

    function sampleImplicit(field, resolution = 92, extent = PI) {
        const n = Math.max(8, Math.floor(resolution));
        const size = n + 1;
        const step = (extent * 2) / n;
        const min = -extent;
        const values = new Float32Array(size ** 3);
        const points = [];
        const index = (i, j, k) => (i * size + j) * size + k;
        const coordinate = i => min + i * step;

        for (let i = 0; i <= n; i += 1) {
            for (let j = 0; j <= n; j += 1) {
                for (let k = 0; k <= n; k += 1) {
                    values[index(i, j, k)] = field(coordinate(i), coordinate(j), coordinate(k));
                }
            }
        }

        function gradient(x, y, z) {
            const e = step * 0.18;
            return normalizeVector([
                field(x + e, y, z) - field(x - e, y, z),
                field(x, y + e, z) - field(x, y - e, z),
                field(x, y, z + e) - field(x, y, z - e)
            ]);
        }

        function addCrossing(i, j, k, axis) {
            const delta = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
            const a = values[index(i, j, k)];
            const b = values[index(i + delta[0], j + delta[1], k + delta[2])];
            if ((a >= 0) === (b >= 0) || Math.abs(a - b) < 1e-9) return;
            const amount = a / (a - b);
            const x = coordinate(i) + delta[0] * step * amount;
            const y = coordinate(j) + delta[1] * step * amount;
            const z = coordinate(k) + delta[2] * step * amount;
            points.push([x, y, z, ...gradient(x, y, z)]);
        }

        for (let i = 0; i <= n; i += 1) {
            for (let j = 0; j <= n; j += 1) {
                for (let k = 0; k <= n; k += 1) {
                    if (i < n) addCrossing(i, j, k, 0);
                    if (j < n) addCrossing(i, j, k, 1);
                    if (k < n) addCrossing(i, j, k, 2);
                }
            }
        }
        return normalizeGeometry(points);
    }

    function sampleCurve(fn, range = [0, TAU], steps = 2600, radius = 0.09, ringSteps = 28) {
        const points = [];
        const dt = (range[1] - range[0]) / steps;
        for (let i = 0; i <= steps; i += 1) {
            const t = range[0] + dt * i;
            const center = fn(t);
            const before = fn(t - dt * 0.4);
            const after = fn(t + dt * 0.4);
            if (!isFinitePoint(center) || !isFinitePoint(before) || !isFinitePoint(after)) continue;
            const tangent = normalizeVector(subtract(after, before));
            const reference = Math.abs(tangent[1]) < 0.88 ? [0, 1, 0] : [1, 0, 0];
            const basisA = normalizeVector(cross(tangent, reference));
            const basisB = normalizeVector(cross(tangent, basisA));
            for (let ring = 0; ring < ringSteps; ring += 1) {
                const angle = TAU * ring / ringSteps;
                const normal = [
                    basisA[0] * Math.cos(angle) + basisB[0] * Math.sin(angle),
                    basisA[1] * Math.cos(angle) + basisB[1] * Math.sin(angle),
                    basisA[2] * Math.cos(angle) + basisB[2] * Math.sin(angle)
                ];
                points.push([
                    center[0] + normal[0] * radius,
                    center[1] + normal[1] * radius,
                    center[2] + normal[2] * radius,
                    ...normal
                ]);
            }
        }
        return normalizeGeometry(points);
    }

    function sampleSurface(fn, uRange, vRange, uSteps = 480, vSteps = 160) {
        const points = [];
        const du = (uRange[1] - uRange[0]) / uSteps;
        const dv = (vRange[1] - vRange[0]) / vSteps;
        const epsilonU = du * 0.3 || 0.001;
        const epsilonV = dv * 0.3 || 0.001;

        for (let i = 0; i <= uSteps; i += 1) {
            const u = uRange[0] + du * i;
            for (let j = 0; j <= vSteps; j += 1) {
                const v = vRange[0] + dv * j;
                const point = fn(u, v);
                const pointU = fn(u + epsilonU, v);
                const pointV = fn(u, v + epsilonV);
                if (!isFinitePoint(point) || !isFinitePoint(pointU) || !isFinitePoint(pointV)) continue;
                const normal = normalizeVector(cross(subtract(pointU, point), subtract(pointV, point)));
                points.push([...point, ...normal]);
            }
        }
        return normalizeGeometry(points);
    }

    function radialSuperformula(angle, m, n1, n2, n3, a = 1, b = 1) {
        const first = Math.pow(Math.abs(Math.cos(m * angle / 4) / a), n2);
        const second = Math.pow(Math.abs(Math.sin(m * angle / 4) / b), n3);
        return Math.pow(first + second, -1 / n1);
    }

    // Flagship 3D Volumetric Manifolds (Ultra-dense, solid surfaces matching gallery fidelity)
    const CANDIDATE_MODELS = [
        {
            id: 'neovius',
            name: 'Neovius / Lidinoid TPMS',
            type: 'Implicit TPMS',
            generator: () => sampleImplicit((x, y, z) => 3 * (Math.cos(x) + Math.cos(y) + Math.cos(z)) + 4 * Math.cos(x) * Math.cos(y) * Math.cos(z), 92, PI * 0.94)
        },
        {
            id: 'gyroid',
            name: 'Gyroid Minimal Surface',
            type: 'Triply Periodic Minimal Surface',
            generator: () => sampleImplicit((x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x), 92, PI * 0.94)
        },
        {
            id: 'lissajous',
            name: 'Lissajous 3D Quantum Orbit',
            type: 'Parametric Knot Tube',
            generator: () => sampleCurve(t => [Math.sin(3 * t + PI / 2), Math.sin(4 * t), Math.sin(5 * t)], [0, TAU], 2600, 0.09, 28)
        },
        {
            id: 'superformula',
            name: 'Supershape 3D Crystal',
            type: 'Radial Gielis Manifold',
            generator: () => sampleSurface((u, v) => {
                const r1 = radialSuperformula(u, 6, 0.8, 1.0, 1.0);
                const r2 = radialSuperformula(v, 4, 0.8, 1.0, 1.0);
                return [r1 * Math.cos(u) * r2 * Math.cos(v), r1 * Math.sin(u) * r2 * Math.cos(v), r2 * Math.sin(v)];
            }, [-PI, PI], [-PI / 2, PI / 2], 480, 160)
        }
    ];

    // Select via URL parameter (?model=neovius / gyroid / lissajous / superformula) or pick 1 randomly
    const urlParams = new URLSearchParams(window.location.search);
    const requestedModel = (urlParams.get('model') || (window.location.hash.match(/model=([a-z0-9-]+)/i) || [])[1] || '').toLowerCase();
    const matchedSpecimen = CANDIDATE_MODELS.find(m => m.id === requestedModel);
    const selectedSpecimen = matchedSpecimen || CANDIDATE_MODELS[Math.floor(Math.random() * CANDIDATE_MODELS.length)];
    const rawGeometry = selectedSpecimen.generator();
    const pointCount = rawGeometry.length;
    const pointData = new Float32Array(pointCount * 6);
    for (let i = 0; i < pointCount; i += 1) {
        const p = rawGeometry[i];
        const off = i * 6;
        pointData[off] = p[0];
        pointData[off + 1] = p[1];
        pointData[off + 2] = p[2];
        pointData[off + 3] = p[3];
        pointData[off + 4] = p[4];
        pointData[off + 5] = p[5];
    }

    if (loaderName) {
        loaderName.textContent = selectedSpecimen.name;
    }

    // High performance shading ramp bytes (' .:-=+*#%@')
    const SHADE_BYTES = new Uint8Array([32, 46, 58, 45, 61, 43, 42, 35, 37, 64]);
    const textDecoder = new TextDecoder();

    // Measure character metrics accurately with sub-pixel precision for micro-ASCII font
    function measureMetrics(elem) {
        const span = document.createElement('span');
        span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;letter-spacing:inherit;line-height:inherit;margin:0;padding:0;';
        span.textContent = 'WWWWWWWWWW\n'.repeat(10);
        elem.appendChild(span);
        const rect = span.getBoundingClientRect();
        elem.removeChild(span);
        const charWidth = (rect.width / 10) || 1.05;
        const charHeight = (rect.height / 10) || 1.25;
        const aspect = (charWidth > 0 && charHeight > 0) ? (charWidth / charHeight) : 0.85;
        return { charWidth, charHeight, aspect };
    }

    let charMetrics = measureMetrics(spatialOutput);
    let columns = 640;
    let rows = 280;

    // Fixed envelope scales:
    // Fits strictly to the 2 side edges (left & right margins) of the screen
    // Vertically centered at 50%
    let loadingFixedScale = 120;
    let webFixedScale = 120;

    // State Variables
    let introStartTime = 0;
    let introFinished = false;
    let currentSpinPhase = 0.55;
    let spinVelocity = 0.50;

    // Camera & Scale Multiplier State:
    // Overview: targetCameraZ = 2.4, targetScaleMultiplier = 1.0 (exact fit to 2 side edges)
    // Zoomed-in Interior: targetCameraZ = 0.40, targetScaleMultiplier = 2.4 (kept when entering web)
    let currentCameraZ = 2.4;
    let targetCameraZ = 2.4;
    let currentScaleMultiplier = 1.0;
    let targetScaleMultiplier = 1.0;

    let viewMode = 'intro';
    let targetTiltX = 0;
    let targetTiltY = 0;
    let currentTiltX = 0;
    let currentTiltY = 0;

    const starTooltip = starButton ? starButton.querySelector('.singularity-star__tooltip') : null;

    // Precompute global rotational envelope across all 360-degree Y-rotation angles
    // Tests EVERY SINGLE VERTEX in pointData across 96 angles and pitch variations.
    // Mathematically guarantees that no point can ever spill outside the 2 side edges!
    function computeGlobalEnvelope(pointsFlat, totalPoints) {
        const camZ = 2.4;
        const ySteps = 96;
        const pitches = [FIXED_PITCH - 0.10, FIXED_PITCH, FIXED_PITCH + 0.10];
        let maxProjX = 0.0001;

        for (let pIdx = 0; pIdx < pitches.length; pIdx += 1) {
            const pitch = pitches[pIdx];
            const cosX = Math.cos(pitch), sinX = Math.sin(pitch);

            for (let s = 0; s < ySteps; s += 1) {
                const theta = (s * TAU) / ySteps;
                const cosY = Math.cos(theta), sinY = Math.sin(theta);

                // Step by 6 to examine ALL vertices without skipping
                for (let off = 0; off < totalPoints * 6; off += 6) {
                    const x = pointsFlat[off];
                    const y = pointsFlat[off + 1];
                    const z = pointsFlat[off + 2];

                    // Horizontal rotation around Y
                    const x1 = x * cosY + z * sinY;
                    const z1 = -x * sinY + z * cosY;

                    // Pitch elevation around X
                    const z2 = y * sinX + z1 * cosX;

                    const dist = camZ - z2;
                    if (dist > 0.05) {
                        const projX = Math.abs(x1) / dist;
                        if (projX > maxProjX) {
                            maxProjX = projX;
                        }
                    }
                }
            }
        }
        return maxProjX;
    }

    let cachedMaxProjX = 0;

    function updateScales() {
        if (!pointData || !pointCount) return;
        if (!cachedMaxProjX) {
            cachedMaxProjX = computeGlobalEnvelope(pointData, pointCount);
        }
        const halfCols = (columns - 1) / 2;
        const FIT_TARGET = 0.96; // 96% of half-width: perfectly touches within the 2 side margins

        // Fitted strictly to the 2 side edges (left and right) on both Desktop and Mobile
        const fitScaleX = (halfCols * FIT_TARGET) / (cachedMaxProjX || 0.001);
        loadingFixedScale = fitScaleX;
        webFixedScale = fitScaleX;
    }

    // Buffer management for zero-allocation 60fps rendering
    let cachedCols = 0;
    let cachedRows = 0;
    let depthBuffer = null;
    let uint8Grid = null;

    function ensureBuffers(cols, rws) {
        if (cols === cachedCols && rws === cachedRows && uint8Grid) return;
        cachedCols = cols;
        cachedRows = rws;
        const stride = cols + 1; // +1 for '\n'
        const total = stride * rws;
        depthBuffer = new Float32Array(total);
        uint8Grid = new Uint8Array(total);
        uint8Grid.fill(32);
        for (let r = 0; r < rws; r += 1) {
            uint8Grid[r * stride + cols] = 10; // '\n'
        }
    }

    function clearBuffers(cols, rws) {
        const stride = cols + 1;
        depthBuffer.fill(-Infinity);
        for (let r = 0; r < rws; r += 1) {
            uint8Grid.fill(32, r * stride, r * stride + cols);
        }
    }

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    let lastDocHeight = 0;

    function updateHeroAnchors() {
        if (!spatialBg || !spatialOutput) return;

        if (!introFinished) {
            spatialBg.style.position = 'fixed';
            spatialBg.style.height = '100vh';
            spatialBg.style.top = '0px';
            spatialBg.style.left = '0px';
            spatialBg.style.width = '100%';

            spatialOutput.style.position = 'absolute';
            spatialOutput.style.top = '50%';
            spatialOutput.style.left = '50%';
            spatialOutput.style.transform = 'translate(-50%, -50%)';

            if (starButton) {
                starButton.style.position = 'fixed';
                starButton.style.top = '50%';
                starButton.style.left = '50%';
                starButton.style.transform = 'translate(-50%, -50%)';
                starButton.style.zIndex = '100000';
            }
            return;
        }

        // Web mode active
        const isMobile = window.innerWidth < 768;
        const bodyRect = document.body.getBoundingClientRect();

        const docHeight = Math.max(
            document.body.scrollHeight || 0,
            document.documentElement.scrollHeight || 0,
            document.body.offsetHeight || 0,
            document.documentElement.offsetHeight || 0
        );

        // Header and Tail/Footer detection for whole page vertical midpoint
        const header = document.querySelector('.site-header');
        const footer = document.querySelector('.site-footer');
        const headerTop = header ? Math.round(header.getBoundingClientRect().top - bodyRect.top) : 0;
        const footerBottom = footer ? Math.round(footer.getBoundingClientRect().bottom - bodyRect.top) : docHeight;

        // Vertical center between header and tail across the entire web page
        const docCenterY = Math.round((headerTop + footerBottom) / 2);
        const docCenterX = Math.round(window.innerWidth / 2);

        // 1. JAZE Main Center Detection:
        // Luôn định vị chính xác tâm điểm của dòng chữ JAZE main
        const jazeMain = document.querySelector('.jaze-logo-line--main') || document.getElementById('hero-title');
        let jazeCenterY = docCenterY;
        let jazeCenterX = docCenterX;

        if (jazeMain) {
            const jazeRect = jazeMain.getBoundingClientRect();
            jazeCenterY = Math.round(jazeRect.top - bodyRect.top + jazeRect.height / 2);
            jazeCenterX = Math.round(jazeRect.left - bodyRect.left + jazeRect.width / 2);
        } else {
            const hero = document.querySelector('.home-hero') || document.querySelector('.page-header') || document.querySelector('.page-main');
            if (hero) {
                const heroRect = hero.getBoundingClientRect();
                jazeCenterY = Math.round(heroRect.top - bodyRect.top + heroRect.height / 2);
                jazeCenterX = Math.round(heroRect.left - bodyRect.left + heroRect.width / 2);
            }
        }

        // Singularity Star Anchor:
        // Luôn nằm chính giữa chữ JAZE main trên cả desktop và mobile!
        if (starButton) {
            starButton.style.position = 'absolute';
            starButton.style.top = `${jazeCenterY}px`;
            starButton.style.left = `${jazeCenterX}px`;
            starButton.style.transform = 'translate(-50%, -50%)';
            starButton.style.zIndex = '50';
        }

        // 2. 3D ASCII Model Positioning:
        if (viewMode === 'interior') {
            // Trạng thái Zoom (interior dive):
            // Background tràn toàn bộ màn hình (fixed fullscreen background).
            // 3D model bao phủ toàn bộ khung nhìn phía sau Hero và toàn bộ trang web,
            // đảm bảo phần Hero ở đầu trang luôn thấy rõ 3D model lộng lẫy, không bao giờ bị đen hay che khuất.
            spatialBg.style.position = 'fixed';
            spatialBg.style.top = '0px';
            spatialBg.style.left = '0px';
            spatialBg.style.width = '100vw';
            spatialBg.style.height = '100vh';

            spatialOutput.style.position = 'absolute';
            spatialOutput.style.top = '50%';
            spatialOutput.style.left = '50%';
            spatialOutput.style.transform = 'translate(-50%, -50%)';
        } else {
            // Trạng thái Thu nhỏ / Không Zoom (exterior overview):
            if (Math.abs(lastDocHeight - docHeight) > 4) {
                lastDocHeight = docHeight;
                spatialBg.style.height = `${docHeight}px`;
            }
            spatialBg.style.position = 'absolute';
            spatialBg.style.top = '0px';
            spatialBg.style.left = '0px';
            spatialBg.style.width = '100%';

            if (isMobile) {
                // Mobile ở trạng thái không zoom: căn ở giữa chữ JAZE main và 2 cạnh bên màn hình.
                // Đứng yên ở giữa chữ JAZE main và cuộn tự nhiên theo hero khi lướt trang.
                spatialOutput.style.position = 'absolute';
                spatialOutput.style.top = `${jazeCenterY}px`;
                spatialOutput.style.left = `${jazeCenterX}px`;
                spatialOutput.style.transform = 'translate(-50%, -50%)';
            } else {
                // Desktop ở trạng thái không zoom: căn ở giữa toàn bộ trang web theo chiều dọc (docCenterY),
                // độ to phụ thuộc vào 2 cạnh bên màn hình để không bị khuất khi xoay.
                spatialOutput.style.position = 'absolute';
                spatialOutput.style.top = `${docCenterY}px`;
                spatialOutput.style.left = `${docCenterX}px`;
                spatialOutput.style.transform = 'translate(-50%, -50%)';
            }
        }
    }

    function resizeSpatialGrid() {
        const width = window.innerWidth || document.documentElement.clientWidth || 1200;
        const height = window.innerHeight || document.documentElement.clientHeight || 800;
        charMetrics = measureMetrics(spatialOutput);
        const w = Math.max(charMetrics.charWidth, 0.5);
        const h = Math.max(charMetrics.charHeight, 0.5);

        // Full width resolution: spans 100% of the screen width to fit the 2 side edges!
        columns = Math.max(80, Math.floor(width / w));
        const aspect = charMetrics.aspect;
        const viewportRows = Math.floor(height / h);
        const modelRowsNeeded = Math.ceil(columns * aspect * 1.15);
        rows = Math.max(viewportRows, modelRowsNeeded);

        ensureBuffers(columns, rows);
        updateScales();
        updateHeroAnchors();
    }
    resizeSpatialGrid();
    window.addEventListener('resize', resizeSpatialGrid, { passive: true });
    window.addEventListener('load', () => {
        updateHeroAnchors();
    }, { passive: true });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            updateHeroAnchors();
        });
    }

    if (typeof ResizeObserver !== 'undefined') {
        const docResizeObserver = new ResizeObserver(() => {
            if (introFinished) {
                updateHeroAnchors();
            }
        });
        docResizeObserver.observe(document.body);
    }

    // Add intro-active state to body so content fades in after intro
    document.body.classList.add('intro-active');
    spatialBg.classList.add('site-spatial-bg--intro');

    // Mouse parallax with smooth inertia (only active post-intro for fine mouse pointer)
    window.addEventListener('pointermove', event => {
        if (!introFinished || !finePointer.matches) return;
        const nx = (event.clientX / window.innerWidth) * 2 - 1;
        const ny = (event.clientY / window.innerHeight) * 2 - 1;
        targetTiltX = clamp(ny * 0.14, -0.16, 0.16);
        targetTiltY = clamp(nx * 0.18, -0.20, 0.20);
    }, { passive: true });

    // Interactive Star Click Handler:
    // Starts in zoomed-in interior mode. Clicking toggles between exterior width-fit overview and interior dive.
    function togglePerspective() {
        if (!introFinished) return;
        if (viewMode === 'interior') {
            viewMode = 'exterior';
            targetCameraZ = 2.4;
            targetScaleMultiplier = 1.0; // Fit to 2 side edges
            spatialBg.classList.remove('site-spatial-bg--interior');
            spatialBg.classList.add('site-spatial-bg--exterior');
            if (starButton) {
                starButton.setAttribute('aria-label', 'View 3D interior (Dive inside)');
                starButton.setAttribute('title', 'Click: Dive inside model');
            }
            if (starTooltip) {
                starTooltip.textContent = 'Dive Inside';
            }
        } else {
            viewMode = 'interior';
            targetCameraZ = 0.40;
            targetScaleMultiplier = 2.4; // Dive inside manifold
            spatialBg.classList.remove('site-spatial-bg--exterior');
            spatialBg.classList.add('site-spatial-bg--interior');
            if (starButton) {
                starButton.setAttribute('aria-label', 'View 3D exterior overview');
                starButton.setAttribute('title', 'Click: Zoom out to fit screen width');
            }
            if (starTooltip) {
                starTooltip.textContent = 'Zoom Out';
            }
        }
        updateHeroAnchors();
    }

    if (starButton) {
        starButton.addEventListener('click', togglePerspective);
    }

    function completeIntro() {
        if (introFinished) return;
        introFinished = true;
        document.body.classList.remove('intro-active');

        // KEEP THE ZOOM POSITION WHEN ENTERING THE WEB!
        viewMode = 'interior';
        currentCameraZ = 0.40;
        targetCameraZ = 0.40;
        currentScaleMultiplier = 2.4;
        targetScaleMultiplier = 2.4;

        spatialBg.classList.remove('site-spatial-bg--intro');
        spatialBg.classList.remove('site-spatial-bg--exterior');
        spatialBg.classList.add('site-spatial-bg--interior');

        if (introLoader) {
            introLoader.classList.add('intro-loader--dissolving');
            window.setTimeout(() => {
                introLoader.classList.add('intro-loader--hidden');
            }, 800);
        }

        updateHeroAnchors();

        if (starButton) {
            starButton.classList.add('singularity-star--interactive');
            starButton.setAttribute('aria-label', 'View 3D exterior overview');
            starButton.setAttribute('title', 'Click: Zoom out to fit screen width');
            if (starTooltip) {
                starTooltip.textContent = 'Zoom Out';
            }
        }
    }

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !introFinished) {
            completeIntro();
        }
    });

    // Lighting vector
    const lightVector = normalizeVector([-0.35, 0.72, 0.6]);

    // High-density, zero-allocation 3D ASCII rasterization
    function renderSpatialFrame(pointsFlat, count, cols, rws, rotX, rotY, rotZ, camZ, activeScale) {
        ensureBuffers(cols, rws);

        const halfCols = (cols - 1) / 2;
        const halfRows = (rws - 1) / 2;
        const aspect = charMetrics.aspect;

        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

        const scaleX = activeScale;
        const scaleY = activeScale * aspect;

        clearBuffers(cols, rws);

        const isZoomed = camZ < 1.0 || activeScale > loadingFixedScale * 1.15;
        const nearClipMin = 0.05;
        const nearClipFade = 0.22;
        const stride = cols + 1;

        for (let i = 0; i < count; i += 1) {
            const off = i * 6;
            const x = pointsFlat[off], y = pointsFlat[off + 1], z = pointsFlat[off + 2];
            const nx = pointsFlat[off + 3], ny = pointsFlat[off + 4], nz = pointsFlat[off + 5];

            // 1. Horizontal rotation strictly around Y axis
            const x1 = x * cosY + z * sinY;
            const z1 = -x * sinY + z * cosY;
            const nx1 = nx * cosY + nz * sinY;
            const nz1 = -nx * sinY + nz * cosY;

            // 2. Pitch elevation around X axis
            const y2 = y * cosX - z1 * sinX;
            const z2 = y * sinX + z1 * cosX;
            const ny2 = ny * cosX - nz1 * sinX;
            const nz2 = ny * sinX + nz1 * cosX;

            // 3. Roll bank around Z axis
            const x3 = x1 * cosZ - y2 * sinZ;
            const y3 = x1 * sinZ + y2 * cosZ;
            const nx3 = nx1 * cosZ - ny2 * sinZ;
            const ny3 = nx1 * sinZ + ny2 * cosZ;
            const z3 = z2;
            const nz3 = nz2;

            const dist = camZ - z3;
            if (dist <= nearClipMin) continue;

            const invDist = 1 / dist;
            const screenXExact = halfCols + x3 * invDist * scaleX;
            const screenYExact = halfRows - y3 * invDist * scaleY;
            const screenX = Math.round(screenXExact);
            const screenY = Math.round(screenYExact);

            if (screenX < 0 || screenX >= cols || screenY < 0 || screenY >= rws) continue;
            const cellIndex = screenY * stride + screenX;

            if (z3 <= depthBuffer[cellIndex]) continue;
            depthBuffer[cellIndex] = z3;

            // Surface diffuse lighting & depth shading for rich volumetric fill (matching gallery fidelity)
            const diffuse = Math.abs(nx3 * lightVector[0] + ny3 * lightVector[1] + nz3 * lightVector[2]);
            const depthFactor = clamp((z3 + 1.2) / 2.4, 0, 1);
            let brightness = clamp(0.12 + diffuse * 0.68 + depthFactor * 0.20, 0, 1);

            // Smooth near-clip attenuation (eliminates character pop/jitter)
            if (dist < nearClipFade) {
                const nearFactor = clamp((dist - nearClipMin) / (nearClipFade - nearClipMin), 0, 1);
                brightness *= nearFactor * nearFactor;
            }

            const shadeIndex = Math.min(SHADE_BYTES.length - 1, Math.max(0, Math.floor(brightness * SHADE_BYTES.length)));
            const shadeByte = SHADE_BYTES[shadeIndex];
            uint8Grid[cellIndex] = shadeByte;

            // Enhanced surface fill in zoom state:
            // Fills subpixel neighbor with proper depth testing and identical shadeByte (zero flickering)
            if (isZoomed) {
                const dx = screenXExact - screenX;
                const dy = screenYExact - screenY;
                const splatZ = z3 - 0.001;

                if (dx > 0.15 && screenX + 1 < cols) {
                    const rIdx = cellIndex + 1;
                    if (splatZ > depthBuffer[rIdx]) {
                        depthBuffer[rIdx] = splatZ;
                        uint8Grid[rIdx] = shadeByte;
                    }
                } else if (dx < -0.15 && screenX - 1 >= 0) {
                    const lIdx = cellIndex - 1;
                    if (splatZ > depthBuffer[lIdx]) {
                        depthBuffer[lIdx] = splatZ;
                        uint8Grid[lIdx] = shadeByte;
                    }
                }

                if (dy > 0.15 && screenY + 1 < rws) {
                    const dIdx = cellIndex + stride;
                    if (splatZ > depthBuffer[dIdx]) {
                        depthBuffer[dIdx] = splatZ;
                        uint8Grid[dIdx] = shadeByte;
                    }
                } else if (dy < -0.15 && screenY - 1 >= 0) {
                    const uIdx = cellIndex - stride;
                    if (splatZ > depthBuffer[uIdx]) {
                        depthBuffer[uIdx] = splatZ;
                        uint8Grid[uIdx] = shadeByte;
                    }
                }
            }
        }

        return textDecoder.decode(uint8Grid);
    }

    // Main 60fps Animation Loop
    let lastTime = 0;

    function tick(timestamp) {
        window.requestAnimationFrame(tick);
        if (!introStartTime) introStartTime = timestamp;
        const elapsed = timestamp - introStartTime;
        const dt = lastTime ? clamp((timestamp - lastTime) / 1000, 0, 0.05) : 0.016;
        lastTime = timestamp;

        let activeScale = loadingFixedScale;

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

            // Smooth rotation around Y axis & zoom choreography
            if (progress < 0.60) {
                // Phase 1: Pure horizontal spin around Y, scale is 100% fixed to 2 screen sides
                spinVelocity = 0.52 + progress * 0.45;
                currentCameraZ = 2.4;
                currentScaleMultiplier = 1.0;
                activeScale = loadingFixedScale;
            } else if (progress < 0.74) {
                // Phase 2: Gentle progressive windup without strobe effect
                const norm = (progress - 0.60) / 0.14;
                spinVelocity = 0.79 + norm * 0.61; // up to ~1.4 rad/sec
                currentCameraZ = 2.4;
                currentScaleMultiplier = 1.0;
                activeScale = loadingFixedScale;
            } else {
                // Phase 3 (2.22s to 3.0s): Dive toward center along Y-rotation axis!
                const norm = (progress - 0.74) / 0.26;
                const zoomEase = norm * norm * (3 - 2 * norm); // cubic Hermite ease
                currentCameraZ = 2.4 - zoomEase * (2.4 - 0.40);
                currentScaleMultiplier = 1.0 + zoomEase * 1.4; // up to 2.4x
                activeScale = loadingFixedScale * currentScaleMultiplier;
                spinVelocity = 1.4 - norm * 1.0; // smoothly decelerates into the dive
            }

            if (elapsed >= INTRO_DURATION_MS) {
                completeIntro();
            }
        } else {
            // Post-intro in normal web mode:
            // Continuous rotation around Y axis at steady ambient drift
            const targetSpeed = 0.18;
            spinVelocity += (targetSpeed - spinVelocity) * (1 - Math.exp(-3 * dt));

            currentCameraZ += (targetCameraZ - currentCameraZ) * 0.08;
            currentScaleMultiplier += (targetScaleMultiplier - currentScaleMultiplier) * 0.08;
            activeScale = webFixedScale * currentScaleMultiplier;

            // Smooth mouse tilt interpolation
            currentTiltX += (targetTiltX - currentTiltX) * (1 - Math.exp(-6 * dt));
            currentTiltY += (targetTiltY - currentTiltY) * (1 - Math.exp(-6 * dt));
        }

        currentSpinPhase += spinVelocity * dt;

        // Render Frame:
        // Horizontal rotation strictly around Y axis
        const rotY = currentSpinPhase;
        const rotX = FIXED_PITCH + currentTiltX;
        const rotZ = currentTiltY * 0.12;

        spatialOutput.textContent = renderSpatialFrame(
            pointData,
            pointCount,
            columns,
            rows,
            rotX,
            rotY,
            rotZ,
            currentCameraZ,
            activeScale
        );
    }

    // Kinetic 3-Tier JAZE Logo Sub-Lines Engine:
    // Only uses the 3 designated script fonts, changes only 1 of 4 characters at a time at a slow, calm pace
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

        // Initialize all sub characters with distinct script fonts immediately
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

        // Respect reduced motion: no recurring mutation if user prefers reduced motion
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) return;

        let nextTarget = 'top';
        let lastSlotIndex = -1;

        // Slow pace: mutations strictly change only 1 character among the 4 slots at a time
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

        // 1800ms slow interval, exactly 1 character changes per cycle
        window.setInterval(tickSingleMutation, 1800);
    }

    initHeroLogoAnimation();
    window.requestAnimationFrame(tick);
}());
