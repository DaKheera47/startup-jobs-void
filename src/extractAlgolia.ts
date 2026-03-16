import { extractAlgoliaConfigInBrowser, USER_AGENT } from './algolia.js';

async function main(): Promise<void> {
    const config = await extractAlgoliaConfigInBrowser();

    const response = await fetch(`https://${config.applicationId}-dsn.algolia.net/1/indexes/${config.indexPost}/query`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': USER_AGENT,
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
}

await main();
