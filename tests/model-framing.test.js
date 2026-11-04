'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/intro-loader.js'), 'utf8');
const scale = Number(source.match(/const MODEL_VISUAL_SCALE = ([\d.]+);/)[1]);
const calibration = source.slice(source.indexOf('    function updateScaleCalibration()'), source.indexOf('    function ensureCanvas2dBuffers()'));
const models = { neovius: [0.80, 0.80], gyroid: [1.00, 1.08], lissajous: [0.84, 0.91], superformula: [0.485, 0.47] };

test('explicit visual scale matches the measured old framing without depending on font width', () => {
    assert.ok(Math.abs(scale / (1.209564208984375 / 1.3199920654296875) - 1) < 0.0001);
    for (const [width, height] of [[1440, 900], [2560, 1080], [768, 1024], [390, 844], [320, 568]]) {
        for (const [model, [x, y]] of Object.entries(models)) {
            const mobile = width < 768 || width < height;
            const base = mobile ? Math.max(width * 1.45, height * 0.70) * 0.5 / y
                : Math.min(width * 0.5 * 0.94 / x, height * 0.5 * 1.75 / y);
            for (const cellW of [1.15, 1.209564208984375, 1.3199920654296875, 1.5]) {
                const context = { window: { innerWidth: width, innerHeight: height }, MODEL_VISUAL_SCALE: scale,
                    MODEL_ENVELOPES: { [model]: { maxProjX: x, maxProjY: y } }, currentModelId: model,
                    cellW, cellH: 2, width, height, fitScaleX: 0, cols: 0, rows: 0, cachedMaxProjX: 0, cachedMaxProjY: 0 };
                vm.runInNewContext(`${calibration}\nupdateScaleCalibration();`, context);
                const focal = context.fitScaleX * cellW;
                assert.ok(Math.abs(focal / base - scale) < 1e-12, `${width}px ${model} ${cellW}: apply scale exactly once`);
                assert.ok(context.cols >= 1 && context.rows >= 1);
                // Both engines derive the same physical projection from the
                // calibrated grid focal. Perspective multipliers stay intact.
                for (const zoom of [1, mobile ? 1.95 : 1.35]) {
                    assert.ok(Math.abs((focal * zoom) / (base * zoom) - scale) < 1e-12);
                }
            }
        }
    }
});
