'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
    buildMemberLookup,
    filterCvesByFinder,
    joinCvesWithLocalRecords,
    validateCveFinders
} = require('./cve-data');
const {
    normalizePostsList,
    validateContentDataset
} = require('./content-contracts');

const projectRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(projectRoot, 'assets', 'data');

async function readJson(filePath) {
    let raw;
    try {
        raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read ${path.relative(projectRoot, filePath)}: ${error.message}`);
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in ${path.relative(projectRoot, filePath)}: ${error.message}`);
    }
}

async function loadPostDocuments(postsList) {
    const normalizedPosts = normalizePostsList(postsList);
    const documents = {};

    await Promise.all(normalizedPosts.map(async post => {
        const filePath = path.join(dataRoot, 'posts', `${post.slug}.json`);
        documents[post.slug] = await readJson(filePath);
    }));

    return documents;
}

async function loadSiteData({ finder = 'jaze' } = {}) {
    const [members, rawCveList, localRecords, profile, postsList] = await Promise.all([
        readJson(path.join(dataRoot, 'members.json')),
        readJson(path.join(dataRoot, 'cves-list.json')),
        readJson(path.join(dataRoot, 'cves-local.json')),
        readJson(path.join(dataRoot, 'profile.json')),
        readJson(path.join(dataRoot, 'posts-list.json'))
    ]);

    const allCves = validateCveFinders(rawCveList, members);
    const finderCves = filterCvesByFinder(rawCveList, finder);
    const cves = joinCvesWithLocalRecords(finderCves, localRecords);
    const postDocuments = await loadPostDocuments(postsList);
    const content = validateContentDataset({
        profile,
        postsList,
        postsBySlug: postDocuments,
        members
    });
    const memberLookup = buildMemberLookup(members);
    const member = memberLookup.get(String(content.profile.memberId).trim().toLowerCase());

    return Object.freeze({
        ...content,
        allCves,
        cves,
        localRecords,
        member,
        members
    });
}

module.exports = Object.freeze({
    dataRoot,
    loadSiteData,
    readJson
});
