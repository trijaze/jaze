/* Private lab renderer: cached model-space particles -> instanced ASCII glyphs.
 * new JazeAsciiWebGL(canvas); setModel(id); resize(options); render(frame);
 * Geometry and glyphs are cached. The frame path performs no text rendering/readback.
 */
(function exposeJazeAsciiWebGL(global) {
    'use strict';

    const PI = Math.PI;
    const TAU = PI * 2;
    const GLYPHS = ' .:-=+*#%@';
    const GEOMETRY_CACHE = new Map();
    const PARTICLE_CACHE = new Map();
    const MAX_OUTPUT_PIXELS = 8000000;
    const MAX_SCENE_PIXELS = 4000000;
    const TETRAHEDRA = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
    const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

    const MESH_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    uniform mat3 uRotation;
    uniform vec2 uViewport;
    uniform float uFocal;
    uniform float uCamera;
    uniform vec2 uOffset;
    out vec3 vNormal;
    out float vDepth;
    out float vDistance;
    void main() {
        vec3 p = uRotation * aPosition;
        float d = uCamera - p.z;
        float nearPlane = 0.05;
        float farPlane = 12.0;
        float clipZ = ((farPlane + nearPlane) * d - 2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
        gl_Position = vec4(2.0 * p.xy * uFocal / uViewport + uOffset * d, clipZ, d);
        vNormal = uRotation * aNormal;
        vDepth = p.z;
        vDistance = d;
    }`;

    const MESH_FRAGMENT = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in float vDepth;
    in float vDistance;
    out vec4 outColor;
    void main() {
        vec3 light = normalize(vec3(-0.35, 0.72, 0.6));
        float diffuse = abs(dot(normalize(vNormal), light));
        float depthShade = clamp((vDepth + 1.2) / 2.4, 0.0, 1.0);
        float fade = smoothstep(0.05, 0.22, vDistance);
        float luminance = clamp(0.12 + 0.68 * diffuse + 0.20 * depthShade, 0.0, 1.0) * fade;
        outColor = vec4(luminance, 0.0, 0.0, 1.0);
    }`;

    const FULLSCREEN_VERTEX = `#version 300 es
    precision highp float;
    void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

    const ASCII_FRAGMENT = `#version 300 es
    precision highp float;
    uniform sampler2D uScene;
    uniform sampler2D uAtlas;
    uniform vec2 uCellPixels;
    uniform vec2 uGrid;
    uniform vec2 uAtlasSize;
    uniform vec2 uGlyphSize;
    uniform vec3 uColor;
    uniform float uSurfaceFill;
    uniform int uSupersample;
    out vec4 outColor;
    void main() {
        vec2 cell = floor(gl_FragCoord.xy / uCellPixels);
        if (any(greaterThanEqual(cell, uGrid)) || uSurfaceFill <= 0.0) {
            outColor = vec4(0.0);
            return;
        }
        ivec2 base = ivec2(cell) * uSupersample;
        vec4 sampleValue = texelFetch(uScene, base, 0);
        if (uSupersample == 2) {
            sampleValue += texelFetch(uScene, base + ivec2(1,0), 0);
            sampleValue += texelFetch(uScene, base + ivec2(0,1), 0);
            sampleValue += texelFetch(uScene, base + ivec2(1,1), 0);
            sampleValue *= 0.25;
        }
        float coverage = sampleValue.a;
        if (coverage <= 0.001) {
            outColor = vec4(0.0);
            return;
        }
        float luminance = sampleValue.r / max(coverage, 0.0001);
        float glyph = floor(clamp(luminance * 10.0, 0.0, 9.0));
        vec2 local = fract(gl_FragCoord.xy / uCellPixels);
        vec2 tile = uGlyphSize + vec2(4.0);
        vec2 atlasPixel = vec2(glyph * tile.x + 2.0, 2.0) + vec2(local.x, 1.0 - local.y) * uGlyphSize;
        float ink = texture(uAtlas, atlasPixel / uAtlasSize).a;
        float alpha = ink * coverage;
        if (alpha < 0.01) {
            outColor = vec4(0.0);
            return;
        }
        outColor = vec4(uColor, alpha);
    }`;

    const PARTICLE_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    uniform mat3 uRotation;
    uniform vec2 uViewport;
    uniform vec2 uGlyphCss;
    uniform float uFocal;
    uniform float uCamera;
    uniform vec2 uOffset;
    out vec2 vLocal;
    flat out vec2 vCenterUv;
    flat out float vDistance;
    flat out float vGlyph;
    flat out float vFade;
    void main() {
        vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
        vec2 corner = corners[gl_VertexID];
        vec3 p = uRotation * aPosition;
        float d = uCamera - p.z;
        float nearPlane = 0.05;
        float farPlane = 12.0;
        float clipZ = ((farPlane + nearPlane) * d - 2.0 * farPlane * nearPlane) / (farPlane - nearPlane);
        vec2 centerClip = 2.0 * p.xy * uFocal / uViewport + uOffset * d;
        // Offset the quad from a continuous projected center. No cell snapping.
        vec2 offsetClip = corner * uGlyphCss / uViewport * d;
        gl_Position = d > nearPlane ? vec4(centerClip + offsetClip, clipZ, d) : vec4(2,2,2,1);
        vCenterUv = centerClip / max(d, 0.0001) * 0.5 + 0.5;
        vDistance = d;
        vLocal = corner * 0.5 + 0.5;
        vec3 normal = normalize(uRotation * aNormal);
        float diffuse = abs(dot(normal, normalize(vec3(-0.35,0.72,0.6))));
        float brightness = clamp(0.12 + diffuse * 0.68 + clamp((p.z + 1.2) / 2.4,0.0,1.0) * 0.20,0.0,1.0);
        vGlyph = floor(clamp(brightness * 10.0,0.0,9.0));
        vFade = smoothstep(0.05,0.22,d);
    }`;

    const PARTICLE_FRAGMENT = `#version 300 es
    precision highp float;
    uniform sampler2D uDepth;
    uniform sampler2D uAtlas;
    uniform vec2 uAtlasSize;
    uniform vec2 uGlyphSize;
    uniform vec3 uColor;
    in vec2 vLocal;
    flat in vec2 vCenterUv;
    flat in float vDistance;
    flat in float vGlyph;
    flat in float vFade;
    out vec4 outColor;
    void main() {
        if (any(lessThan(vCenterUv,vec2(0))) || any(greaterThan(vCenterUv,vec2(1)))) discard;
        ivec2 size = textureSize(uDepth,0);
        ivec2 sampleAt = clamp(ivec2(vCenterUv * vec2(size)),ivec2(0),size-1);
        float depth = texelFetch(uDepth,sampleAt,0).r;
        float ndc = depth * 2.0 - 1.0;
        float sceneDistance = 2.0 * 0.05 * 12.0 / (12.0 + 0.05 - ndc * (12.0 - 0.05));
        // Sample depth at the particle center, not each glyph corner. A small
        // view-space tolerance covers cell-sized depth prepass quantization.
        vec2 tile = uGlyphSize + vec2(4);
        vec2 pixel = vec2(vGlyph * tile.x + 2.0,2.0) + vec2(vLocal.x,1.0-vLocal.y) * uGlyphSize;
        float ink = texture(uAtlas,pixel/uAtlasSize).a * vFade;
        if (ink < 0.015) discard;
        outColor = vec4(uColor, ink);
    }`;

    function unit(x, y, z) {
        const length = Math.hypot(x, y, z) || 1;
        return [x / length, y / length, z / length];
    }

    function normalizeMesh(vertices) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < vertices.length; i += 6) {
            for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], vertices[i + axis]);
                max[axis] = Math.max(max[axis], vertices[i + axis]);
            }
        }
        const center = min.map((value, axis) => (value + max[axis]) / 2);
        const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.0001);
        const data = new Float32Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 6) {
            for (let axis = 0; axis < 3; axis += 1) data[i + axis] = (vertices[i + axis] - center[axis]) * 2.1 / span;
            data[i + 3] = vertices[i + 3];
            data[i + 4] = vertices[i + 4];
            data[i + 5] = vertices[i + 5];
        }
        return data;
    }

    function fieldFor(id) {
        if (id === 'gyroid') return {
            value: (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x),
            normal: (x, y, z) => unit(
                Math.cos(x) * Math.cos(y) - Math.sin(z) * Math.sin(x),
                Math.cos(y) * Math.cos(z) - Math.sin(x) * Math.sin(y),
                Math.cos(z) * Math.cos(x) - Math.sin(y) * Math.sin(z)
            )
        };
        return {
            value: (x, y, z) => 3 * (Math.cos(x) + Math.cos(y) + Math.cos(z)) + 4 * Math.cos(x) * Math.cos(y) * Math.cos(z),
            normal: (x, y, z) => unit(
                -Math.sin(x) * (3 + 4 * Math.cos(y) * Math.cos(z)),
                -Math.sin(y) * (3 + 4 * Math.cos(x) * Math.cos(z)),
                -Math.sin(z) * (3 + 4 * Math.cos(x) * Math.cos(y))
            )
        };
    }

    // Deterministic geometric lattice coordinates inside each triangle:
    // 0: Centroid (balanced center)
    // 1-3: Edge midpoints (form connected wireframe lattice)
    // 4-6: Sub-lattice points toward vertices
    // 7-9: Interior dual lattice points
    const LATTICE_BARYCENTRICS = [
        [1/3, 1/3, 1/3],
        [0.5, 0.5, 0.0],
        [0.0, 0.5, 0.5],
        [0.5, 0.0, 0.5],
        [2/3, 1/6, 1/6],
        [1/6, 2/3, 1/6],
        [1/6, 1/6, 2/3],
        [0.4, 0.4, 0.2],
        [0.2, 0.4, 0.4],
        [0.4, 0.2, 0.4]
    ];
    const PHI = 0.618033988749895; // Golden ratio low-discrepancy stride

    function sampleSurfaceParticles(mesh, count, cacheKey) {
        if (PARTICLE_CACHE.has(cacheKey)) return PARTICLE_CACHE.get(cacheKey);
        const triangleCount = mesh.length / 18;
        const cumulativeArea = new Float64Array(triangleCount);
        let totalArea = 0;
        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
            const offset = triangle * 18;
            const ax = mesh[offset + 6] - mesh[offset];
            const ay = mesh[offset + 7] - mesh[offset + 1];
            const az = mesh[offset + 8] - mesh[offset + 2];
            const bx = mesh[offset + 12] - mesh[offset];
            const by = mesh[offset + 13] - mesh[offset + 1];
            const bz = mesh[offset + 14] - mesh[offset + 2];
            totalArea += Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx) * 0.5;
            cumulativeArea[triangle] = totalArea;
        }
        if (!(totalArea > 0)) throw new Error('Cannot sample an empty surface mesh.');
        let seed = 2166136261;
        for (let i = 0; i < cacheKey.length; i += 1) seed = Math.imul(seed ^ cacheKey.charCodeAt(i),16777619) >>> 0;
        const phaseOffset = ((seed >>> 0) % 10000) / 10000;

        const triangleSampleCount = new Int32Array(triangleCount);
        const particles = new Float32Array(count * 6);
        for (let i = 0; i < count; i += 1) {
            // Low-discrepancy quasi-random Weyl sequence guarantees optimal surface coverage
            // without Poisson noise, clustering, or holes at any prefix fill level
            const u = (phaseOffset + i * PHI) % 1.0;
            const wanted = (u < 0 ? u + 1.0 : u) * totalArea;
            let low = 0, high = triangleCount - 1;
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (cumulativeArea[middle] < wanted) low = middle + 1;
                else high = middle;
            }
            const offset = low * 18;
            const sampleId = triangleSampleCount[low]++;
            const weights = LATTICE_BARYCENTRICS[sampleId % LATTICE_BARYCENTRICS.length];
            const a = weights[0], b = weights[1], c = weights[2];

            const target = i * 6;
            for (let axis = 0; axis < 3; axis += 1) particles[target+axis] = a*mesh[offset+axis]+b*mesh[offset+6+axis]+c*mesh[offset+12+axis];
            const nx = a*mesh[offset+3]+b*mesh[offset+9]+c*mesh[offset+15];
            const ny = a*mesh[offset+4]+b*mesh[offset+10]+c*mesh[offset+16];
            const nz = a*mesh[offset+5]+b*mesh[offset+11]+c*mesh[offset+17];
            const length = Math.hypot(nx,ny,nz) || 1;
            particles[target+3] = nx/length; particles[target+4] = ny/length; particles[target+5] = nz/length;
        }
        PARTICLE_CACHE.set(cacheKey,particles);
        return particles;
    }

    // A consistent six-tetrahedron split of every cube avoids a 256-case MC table.
    // Adjacent cubes share the same face diagonals; output is actual triangles.
    function implicitMesh(id, resolution) {
        const field = fieldFor(id);
        const n = resolution;
        const size = n + 1;
        const extent = PI * 0.94;
        const step = extent * 2 / n;
        const scalar = new Float32Array(size ** 3);
        const index = (i, j, k) => (i * size + j) * size + k;
        const at = i => -extent + i * step;
        for (let i = 0; i <= n; i += 1) {
            for (let j = 0; j <= n; j += 1) {
                for (let k = 0; k <= n; k += 1) scalar[index(i, j, k)] = field.value(at(i), at(j), at(k));
            }
        }
        const vertices = [];
        function crossing(a, b) {
            const t = a[3] / (a[3] - b[3]);
            const x = a[0] + (b[0] - a[0]) * t;
            const y = a[1] + (b[1] - a[1]) * t;
            const z = a[2] + (b[2] - a[2]) * t;
            return [x, y, z, ...field.normal(x, y, z)];
        }
        function triangle(a, b, c) { vertices.push(...a, ...b, ...c); }
        for (let i = 0; i < n; i += 1) {
            for (let j = 0; j < n; j += 1) {
                for (let k = 0; k < n; k += 1) {
                    const cube = CORNERS.map(offset => [at(i + offset[0]), at(j + offset[1]), at(k + offset[2]), scalar[index(i + offset[0], j + offset[1], k + offset[2])]]);
                    for (const tetra of TETRAHEDRA) {
                        const inside = [];
                        const outside = [];
                        for (const corner of tetra) (cube[corner][3] < 0 ? inside : outside).push(cube[corner]);
                        if (inside.length === 0 || inside.length === 4) continue;
                        if (inside.length === 1 || inside.length === 3) {
                            const tip = inside.length === 1 ? inside[0] : outside[0];
                            const others = inside.length === 1 ? outside : inside;
                            triangle(crossing(tip, others[0]), crossing(tip, others[1]), crossing(tip, others[2]));
                        } else {
                            const a = crossing(inside[0], outside[0]);
                            const b = crossing(inside[0], outside[1]);
                            const c = crossing(inside[1], outside[0]);
                            const d = crossing(inside[1], outside[1]);
                            triangle(a, b, c);
                            triangle(b, d, c);
                        }
                    }
                }
            }
        }
        return normalizeMesh(vertices);
    }

    function surfaceMesh(fn, uRange, vRange, uSteps, vSteps) {
        const samples = [];
        const vertices = [];
        const du = (uRange[1] - uRange[0]) / uSteps;
        const dv = (vRange[1] - vRange[0]) / vSteps;
        for (let i = 0; i <= uSteps; i += 1) {
            for (let j = 0; j <= vSteps; j += 1) {
                const u = uRange[0] + i * du;
                const v = vRange[0] + j * dv;
                const point = fn(u, v);
                const a = fn(u + du * 0.05, v);
                const b = fn(u, v + dv * 0.05);
                const ax = a[0] - point[0], ay = a[1] - point[1], az = a[2] - point[2];
                const bx = b[0] - point[0], by = b[1] - point[1], bz = b[2] - point[2];
                samples.push([...point, ...unit(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)]);
            }
        }
        const get = (i, j) => samples[i * (vSteps + 1) + j];
        for (let i = 0; i < uSteps; i += 1) {
            for (let j = 0; j < vSteps; j += 1) {
                vertices.push(...get(i, j), ...get(i + 1, j), ...get(i, j + 1));
                vertices.push(...get(i + 1, j), ...get(i + 1, j + 1), ...get(i, j + 1));
            }
        }
        return normalizeMesh(vertices);
    }

    function lissajousMesh() {
        const fn = t => [Math.sin(3 * t + PI / 2), Math.sin(4 * t), Math.sin(5 * t)];
        return surfaceMesh((t, angle) => {
            const p = fn(t);
            const before = fn(t - 0.0001);
            const after = fn(t + 0.0001);
            const tangent = unit(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
            const reference = Math.abs(tangent[1]) < 0.88 ? [0, 1, 0] : [1, 0, 0];
            const a = unit(tangent[1] * reference[2] - tangent[2] * reference[1], tangent[2] * reference[0] - tangent[0] * reference[2], tangent[0] * reference[1] - tangent[1] * reference[0]);
            const b = unit(tangent[1] * a[2] - tangent[2] * a[1], tangent[2] * a[0] - tangent[0] * a[2], tangent[0] * a[1] - tangent[1] * a[0]);
            return p.map((value, axis) => value + 0.09 * (a[axis] * Math.cos(angle) + b[axis] * Math.sin(angle)));
        }, [0, TAU], [0, TAU], 720, 16);
    }

    function supershapeMesh() {
        const radius = (angle, m) => Math.pow(Math.abs(Math.cos(m * angle / 4)) + Math.abs(Math.sin(m * angle / 4)), -1 / 0.8);
        return surfaceMesh((u, v) => {
            const r1 = radius(u, 6);
            const r2 = radius(v, 4);
            return [r1 * Math.cos(u) * r2 * Math.cos(v), r1 * Math.sin(u) * r2 * Math.cos(v), r2 * Math.sin(v)];
        }, [-PI, PI], [-PI / 2, PI / 2], 160, 80);
    }

    function makeProgram(gl, vertex, fragment) {
        const shaders = [];
        const program = gl.createProgram();
        try {
            for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
                const shader = gl.createShader(type);
                shaders.push(shader);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed.');
                gl.attachShader(program, shader);
            }
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader linking failed.');
            return program;
        } catch (error) {
            gl.deleteProgram(program);
            throw error;
        } finally {
            shaders.forEach(shader => gl.deleteShader(shader));
        }
    }

    function locations(gl, program, names) {
        return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    }

    class JazeAsciiWebGL {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
            if (!this.gl) throw new Error('WebGL2 is unavailable. Select the Canvas2D fallback.');
            this.resolution = Math.max(16, Math.min(72, Math.floor(options.implicitResolution || 40)));
            this.particleCount = Math.max(1000,Math.min(160000,Math.floor(options.particleCount || 80000)));
            this.stats = { available: true, lost: false, model: null, vertices: 0, triangles: 0, totalParticles: 0, visibleInstances: 0, renderStyle: 'particles', buildMs: 0, cpuMs: 0, gpuMs: null };
            this.rotation = new Float32Array(9);
            this.pendingQueries = [];
            this.destroyed = false;
            this.sizeOptions = null;
            this.atlasKey = '';
            this._onLost = event => {
                event.preventDefault();
                this.stats.lost = true;
                this.stats.gpuMs = null;
                this.pendingQueries = [];
                this.canvas.dispatchEvent(new CustomEvent('ascii-renderer-status', { detail: 'WebGL context lost; waiting for recovery.' }));
            };
            this._onRestored = () => {
                try {
                    this.stats.lost = false;
                    this._initialize();
                    if (this.sizeOptions) this.resize(this.sizeOptions);
                    if (this.stats.model) this.setModel(this.stats.model);
                    this.canvas.dispatchEvent(new CustomEvent('ascii-renderer-status', { detail: 'WebGL context restored.' }));
                } catch (error) {
                    this.stats.lost = true;
                    this.canvas.dispatchEvent(new CustomEvent('ascii-renderer-status', { detail: error.message }));
                }
            };
            canvas.addEventListener('webglcontextlost', this._onLost);
            canvas.addEventListener('webglcontextrestored', this._onRestored);
            this._initialize();
        }

        _initialize() {
            const gl = this.gl;
            this.meshProgram = makeProgram(gl, MESH_VERTEX, MESH_FRAGMENT);
            this.asciiProgram = makeProgram(gl, FULLSCREEN_VERTEX, ASCII_FRAGMENT);
            this.particleProgram = makeProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT);
            this.meshUniforms = locations(gl, this.meshProgram, ['uRotation', 'uViewport', 'uFocal', 'uCamera', 'uOffset']);
            this.asciiUniforms = locations(gl, this.asciiProgram, ['uScene', 'uAtlas', 'uCellPixels', 'uGrid', 'uAtlasSize', 'uGlyphSize', 'uColor', 'uSurfaceFill', 'uSupersample']);
            this.particleUniforms = locations(gl, this.particleProgram, ['uRotation', 'uViewport', 'uGlyphCss', 'uFocal', 'uCamera', 'uOffset', 'uDepth', 'uAtlas', 'uAtlasSize', 'uGlyphSize', 'uColor']);
            this.vao = gl.createVertexArray();
            this.fullscreenVao = gl.createVertexArray();
            this.buffer = gl.createBuffer();
            gl.bindVertexArray(this.vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
            gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
            gl.bindVertexArray(null);
            this.particleVao = gl.createVertexArray();
            this.particleBuffer = gl.createBuffer();
            gl.bindVertexArray(this.particleVao);
            gl.bindBuffer(gl.ARRAY_BUFFER,this.particleBuffer);
            gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
            gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
            gl.vertexAttribDivisor(0,1); gl.vertexAttribDivisor(1,1);
            gl.bindVertexArray(null);
            this.framebuffer = gl.createFramebuffer();
            this.sceneTexture = gl.createTexture();
            this.depth = gl.createTexture();
            this.atlas = gl.createTexture();
            this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            this.atlasKey = '';
            this.sceneWidth = 0;
            this.sceneHeight = 0;
            this.gpuModel = null;
            gl.disable(gl.BLEND);
            gl.disable(gl.CULL_FACE);
        }

        setModel(id) {
            if (!['neovius', 'gyroid', 'lissajous', 'superformula'].includes(id)) throw new Error(`Unknown ASCII mesh: ${id}`);
            const started = performance.now();
            const cacheKey = `${id}:${this.resolution}`;
            let data = GEOMETRY_CACHE.get(cacheKey);
            if (!data) {
                data = id === 'lissajous' ? lissajousMesh() : id === 'superformula' ? supershapeMesh() : implicitMesh(id, this.resolution);
                GEOMETRY_CACHE.set(cacheKey, data);
            }
            const particles = sampleSurfaceParticles(data,this.particleCount,`${cacheKey}:${this.particleCount}`);
            this.particleData = particles;
            if (this.gpuModel === id && !this.stats.lost) return this.getStats();
            if (!this.stats.lost) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
                this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.particleBuffer);
                this.gl.bufferData(this.gl.ARRAY_BUFFER,particles,this.gl.STATIC_DRAW);
                this.gpuModel = id;
            }
            this.stats.model = id;
            this.stats.vertices = data.length / 6;
            this.stats.triangles = data.length / 18;
            this.stats.totalParticles = particles.length / 6;
            this.stats.buildMs = performance.now() - started;
            this.stats.gpuMs = null;
            return this.getStats();
        }

        resize(options) {
            this.sizeOptions = { ...options };
            if (this.stats.lost || this.destroyed) return this.getStats();
            const gl = this.gl;
            const width = Math.max(1, options.width);
            const height = Math.max(1, options.height);
            const dpr = Math.min(Math.max(0.5, options.dpr || 1), 2, Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)), this.maxTexture / width, this.maxTexture / height);
            const backingWidth = Math.max(1, Math.round(width * dpr));
            const backingHeight = Math.max(1, Math.round(height * dpr));
            const cellPixelsX = Math.max(2, Math.round((options.cellWidth || 2) * dpr));
            const cellPixelsY = Math.max(2, Math.round((options.cellHeight || 3) * dpr));
            const columns = Math.max(1, Math.floor(backingWidth / cellPixelsX));
            const rows = Math.max(1, Math.floor(backingHeight / cellPixelsY));
            let supersample = options.supersample === 1 ? 1 : 2;
            if (columns * rows * supersample * supersample > MAX_SCENE_PIXELS || columns * supersample > this.maxTexture || rows * supersample > this.maxTexture) supersample = 1;
            this.width = width;
            this.height = height;
            this.canvas.width = backingWidth;
            this.canvas.height = backingHeight;
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
            this.cellPixelsX = cellPixelsX;
            this.cellPixelsY = cellPixelsY;
            Object.assign(this.stats, { columns, rows, dpr, supersample, cellWidth: cellPixelsX / dpr, cellHeight: cellPixelsY / dpr, backingWidth, backingHeight });
            const targetWidth = columns * supersample;
            const targetHeight = rows * supersample;
            if (targetWidth !== this.sceneWidth || targetHeight !== this.sceneHeight) {
                this.sceneWidth = targetWidth;
                this.sceneHeight = targetHeight;
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.bindTexture(gl.TEXTURE_2D,this.depth);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,targetWidth,targetHeight,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);
                gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.depth,0);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('ASCII scene framebuffer is incomplete.');
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
            this._buildAtlas();
            return this.getStats();
        }

        _buildAtlas(force = false) {
            const key = `${this.cellPixelsX}:${this.cellPixelsY}`;
            if (!force && key === this.atlasKey) return;
            const gl = this.gl;
            const tileWidth = this.cellPixelsX + 4;
            const tileHeight = this.cellPixelsY + 4;
            const image = document.createElement('canvas');
            image.width = tileWidth * GLYPHS.length;
            image.height = tileHeight;
            const ctx = image.getContext('2d');
            ctx.clearRect(0, 0, image.width, image.height);
            ctx.fillStyle = '#fff';
            ctx.font = `700 ${Math.min(this.cellPixelsY * 0.98, this.cellPixelsX / 0.6)}px "IBM Plex Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < GLYPHS.length; i += 1) ctx.fillText(GLYPHS[i], i * tileWidth + 2 + this.cellPixelsX / 2, 2 + this.cellPixelsY / 2);
            gl.bindTexture(gl.TEXTURE_2D, this.atlas);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            this.atlasWidth = image.width;
            this.atlasHeight = image.height;
            this.atlasKey = key;
        }

        refreshAtlas() {
            if (!this.stats.lost && this.cellPixelsX) this._buildAtlas(true);
        }

        _pollQueries() {
            const gl = this.gl;
            if (!this.timer || !this.pendingQueries.length) return;
            const first = this.pendingQueries[0];
            if (!gl.getQueryParameter(first, gl.QUERY_RESULT_AVAILABLE)) return;
            const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
            const elapsed = gl.getQueryParameter(first, gl.QUERY_RESULT);
            gl.deleteQuery(first);
            this.pendingQueries.shift();
            if (!disjoint) this.stats.gpuMs = elapsed / 1000000;
        }

        render(frame) {
            if (this.destroyed || this.stats.lost || !this.stats.vertices || !this.sceneWidth) return this.stats;
            const started = performance.now();
            const gl = this.gl;
            this._pollQueries();
            let query = null;
            if (this.timer && this.pendingQueries.length < 3) {
                query = gl.createQuery();
                gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
            }
            const cy = Math.cos(frame.rotY), sy = Math.sin(frame.rotY);
            const cx = Math.cos(frame.rotX), sx = Math.sin(frame.rotX);
            const cz = Math.cos(frame.rotZ), sz = Math.sin(frame.rotZ);
            const r = this.rotation;
            r[0] = cz * cy - sz * sx * sy; r[1] = sz * cy + cz * sx * sy; r[2] = -cx * sy;
            r[3] = -sz * cx; r[4] = cz * cx; r[5] = sx;
            r[6] = cz * sy + sz * sx * cy; r[7] = sz * sy - cz * sx * cy; r[8] = cx * cy;

            const offsetX = frame.offsetX || 0;
            const offsetY = frame.offsetY || 0;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
            gl.clearColor(0, 0, 0, 0);
            gl.clearDepth(1);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(this.meshProgram);
            gl.bindVertexArray(this.vao);
            gl.uniformMatrix3fv(this.meshUniforms.uRotation, false, r);
            gl.uniform2f(this.meshUniforms.uViewport, this.width, this.height);
            gl.uniform1f(this.meshUniforms.uFocal, frame.fitScaleX * (this.sizeOptions.cellWidth || 2) * (frame.scaleMultiplier || 1));
            gl.uniform1f(this.meshUniforms.uCamera, frame.cameraZ);
            gl.uniform2f(this.meshUniforms.uOffset, offsetX, offsetY);
            gl.drawArrays(gl.TRIANGLES, 0, this.stats.vertices);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            const surfaceFill = Number.isFinite(frame.surfaceFill) ? Math.min(1, Math.max(0, frame.surfaceFill)) : 1;
            this.stats.surfaceFill = surfaceFill;
            const renderStyle = frame.renderStyle === 'mesh' ? 'mesh' : 'particles';
            this.stats.renderStyle = renderStyle;
            this.stats.visibleInstances = renderStyle === 'particles' ? Math.floor(this.stats.totalParticles * surfaceFill) : 0;
            if (renderStyle === 'mesh') {
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.disable(gl.DEPTH_TEST);
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.useProgram(this.asciiProgram);
                gl.bindVertexArray(this.fullscreenVao);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.atlas);
                const u = this.asciiUniforms;
                gl.uniform1i(u.uScene, 0);
                gl.uniform1i(u.uAtlas, 1);
                gl.uniform2f(u.uCellPixels, this.cellPixelsX, this.cellPixelsY);
                gl.uniform2f(u.uGrid, this.stats.columns, this.stats.rows);
                gl.uniform2f(u.uAtlasSize, this.atlasWidth, this.atlasHeight);
                gl.uniform2f(u.uGlyphSize, this.cellPixelsX, this.cellPixelsY);
                gl.uniform3f(u.uColor, frame.color[0] / 255, frame.color[1] / 255, frame.color[2] / 255);
                gl.uniform1f(u.uSurfaceFill, surfaceFill > 0 ? 1 : 0);
                gl.uniform1i(u.uSupersample, this.stats.supersample);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.disable(gl.BLEND);
            } else {
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.useProgram(this.particleProgram);
                gl.bindVertexArray(this.particleVao);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D,this.depth);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D,this.atlas);
                const u = this.particleUniforms;
                gl.uniformMatrix3fv(u.uRotation,false,r);
                gl.uniform2f(u.uViewport,this.width,this.height);
                gl.uniform2f(u.uGlyphCss,this.stats.cellWidth,this.stats.cellHeight);
                gl.uniform1f(u.uFocal,frame.fitScaleX*(this.sizeOptions.cellWidth||2)*(frame.scaleMultiplier||1));
                gl.uniform1f(u.uCamera,frame.cameraZ);
                gl.uniform2f(u.uOffset, offsetX, offsetY);
                gl.uniform1i(u.uDepth,0); gl.uniform1i(u.uAtlas,1);
                gl.uniform2f(u.uAtlasSize,this.atlasWidth,this.atlasHeight);
                gl.uniform2f(u.uGlyphSize,this.cellPixelsX,this.cellPixelsY);
                gl.uniform3f(u.uColor,frame.color[0]/255,frame.color[1]/255,frame.color[2]/255);
                if (this.stats.visibleInstances) gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.stats.visibleInstances);
                gl.disable(gl.BLEND);
            }
            if (query) {
                gl.endQuery(this.timer.TIME_ELAPSED_EXT);
                this.pendingQueries.push(query);
            }
            this.stats.cpuMs = performance.now() - started;
            return this.stats;
        }

        getStats() { return { ...this.stats }; }

        // Diagnostics only: model anchors remain constant while their projected
        // CSS centers move continuously. selected is not an occlusion query.
        getParticleProbe(frame, index = 0) {
            if (!this.particleData) return null;
            const id = Math.max(0,Math.min(this.stats.totalParticles-1,Math.floor(index)));
            const off = id*6;
            const x=this.particleData[off],y=this.particleData[off+1],z=this.particleData[off+2];
            const cy=Math.cos(frame.rotY),sy=Math.sin(frame.rotY),cx=Math.cos(frame.rotX),sx=Math.sin(frame.rotX),cz=Math.cos(frame.rotZ),sz=Math.sin(frame.rotZ);
            const x1=x*cy+z*sy,z1=-x*sy+z*cy;
            const y2=y*cx-z1*sx,z2=y*sx+z1*cx;
            const x3=x1*cz-y2*sz,y3=x1*sz+y2*cz;
            const distance=frame.cameraZ-z2;
            const focal=frame.fitScaleX*(this.sizeOptions.cellWidth||2)*(frame.scaleMultiplier||1);
            const centerCss=[this.width/2+x3*focal/distance,this.height/2-y3*focal/distance];
            const fill=Number.isFinite(frame.surfaceFill)?Math.min(1,Math.max(0,frame.surfaceFill)):1;
            return {
                id,index:id,modelPosition:[x,y,z],normal:Array.from(this.particleData.subarray(off+3,off+6)),
                centerCss,screenPosition:centerCss,distance,depth:z2,
                selected:id<Math.floor(this.stats.totalParticles*fill),totalParticles:this.stats.totalParticles
            };
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            const gl = this.gl;
            this.canvas.removeEventListener('webglcontextlost', this._onLost);
            this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
            if (!this.stats.lost) {
                this.pendingQueries.forEach(query => gl.deleteQuery(query));
                gl.deleteBuffer(this.buffer);
                gl.deleteBuffer(this.particleBuffer);
                gl.deleteVertexArray(this.vao);
                gl.deleteVertexArray(this.particleVao);
                gl.deleteVertexArray(this.fullscreenVao);
                gl.deleteProgram(this.meshProgram);
                gl.deleteProgram(this.asciiProgram);
                gl.deleteProgram(this.particleProgram);
                gl.deleteTexture(this.sceneTexture);
                gl.deleteTexture(this.atlas);
                gl.deleteTexture(this.depth);
                gl.deleteFramebuffer(this.framebuffer);
            }
            this.pendingQueries = [];
        }
    }

    global.JazeAsciiWebGL = JazeAsciiWebGL;
}(window));
