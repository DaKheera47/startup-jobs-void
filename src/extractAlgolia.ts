import { chromium } from 'playwright';

import { extractAlgoliaConfig } from './algolia.js';

const STARTUP_JOBS_URL = 'https://startup.jobs';
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: USER_AGENT });

    try {
        await page.goto(STARTUP_JOBS_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('meta[name="current-algolia-api-key-search"]', { timeout: 30_000 });

        const html = await page.content();
        const config = extractAlgoliaConfig(html);

        const response = await fetch(`https://${config.applicationId}-dsn.algolia.net/1/indexes/${config.indexPost}/query`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-algolia-api-key': config.apiKeySearch,
                'x-algolia-application-id': config.applicationId,
            },
            body: JSON.stringify({ query: 'engineer', hitsPerPage: 3 }),
        });

        const data = await response.json();

        console.log(
            JSON.stringify(
                {
                    ...config,
                    status: response.status,
                    ok: response.ok,
                    hitCount: Array.isArray(data.hits) ? data.hits.length : 0,
                    firstHitTitle: data.hits?.[0]?.title ?? null,
                },
                null,
                2,
            ),
        );
    } finally {
        await page.close();
        await browser.close();
    }
}

await main();
