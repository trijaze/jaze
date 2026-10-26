'use strict';

const { loadSiteData } = require('./load-site-data');

async function main() {
    const data = await loadSiteData();
    const published = data.cves.filter(item => item.state === 'PUBLISHED').length;
    const pending = data.cves.length - published;

    console.log(`Validated ${data.members.length} member(s).`);
    console.log(`Validated ${data.allCves.length} total CVE(s) -> ${data.cves.length} Jaze CVE(s).`);
    console.log(`CVE states: ${published} published, ${pending} pending/custom.`);
    console.log(`Validated ${data.posts.length} post index item(s) -> ${data.publishedPosts.length} published.`);
}

main().catch(error => {
    console.error(`Data validation failed: ${error.message}`);
    process.exitCode = 1;
});
