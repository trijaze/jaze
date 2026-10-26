'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(projectRoot, 'dist');
const siteRoot = fs.existsSync(path.join(generatedRoot, 'index.html')) ? generatedRoot : projectRoot;
const port = Number.parseInt(process.env.PORT || '4177', 10);

const MIME_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8'
});

function resolveRequestPath(urlValue) {
    const pathname = decodeURIComponent(new URL(urlValue, 'http://localhost').pathname);
    const relativePath = pathname.replace(/^\/+/, '');

    // Allow direct access to note-jaze/ and gallery routes for ASCII model testing
    if (relativePath === 'gallery' || relativePath === 'gallery.html' || relativePath === 'ascii-model-gallery.html') {
        const galleryCandidate = path.join(projectRoot, 'note-jaze', 'ascii-model-gallery.html');
        if (fs.existsSync(galleryCandidate)) return galleryCandidate;
    }
    if (relativePath === 'ascii-model-gallery.css' || relativePath === 'ascii-model-gallery.js') {
        const assetCandidate = path.join(projectRoot, 'note-jaze', relativePath);
        if (fs.existsSync(assetCandidate)) return assetCandidate;
    }
    if (relativePath.startsWith('note-jaze/') || relativePath === 'note-jaze') {
        const noteJazeDir = path.join(projectRoot, 'note-jaze');
        const candidate = path.resolve(projectRoot, relativePath);
        if (candidate === noteJazeDir || candidate.startsWith(noteJazeDir + path.sep)) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                const galleryIndex = path.join(candidate, 'ascii-model-gallery.html');
                if (fs.existsSync(galleryIndex)) return galleryIndex;
            }
            if (fs.existsSync(candidate)) return candidate;
        }
    }

    const candidate = path.resolve(siteRoot, relativePath || 'index.html');
    if (!candidate.startsWith(siteRoot + path.sep) && candidate !== siteRoot) return null;

    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return path.join(candidate, 'index.html');
    }
    if (!path.extname(candidate)) {
        const nestedIndex = path.join(candidate, 'index.html');
        if (fs.existsSync(nestedIndex)) return nestedIndex;
    }
    return candidate;
}

const server = http.createServer((request, response) => {
    const requestedFile = resolveRequestPath(request.url || '/');
    const fallbackFile = path.join(siteRoot, '404.html');
    const filePath = requestedFile && fs.existsSync(requestedFile) ? requestedFile : fallbackFile;
    const statusCode = requestedFile && fs.existsSync(requestedFile) ? 200 : 404;

    fs.readFile(filePath, (error, data) => {
        if (error) {
            response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Unable to read site file.');
            return;
        }

        response.writeHead(statusCode, {
            'Cache-Control': 'no-store',
            'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        response.end(request.method === 'HEAD' ? undefined : data);
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Jaze site available at http://127.0.0.1:${port}`);
    console.log(`Serving ${siteRoot}`);
});
