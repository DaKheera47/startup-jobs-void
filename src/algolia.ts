import { launchOptions } from 'camoufox-js';
import { Actor, log } from 'apify';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { firefox } from 'playwright';
import type { BrowserContext } from 'playwright';

const META_CONTENT_RE = /<meta\b[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
const STARTUP_JOBS_URL = 'https://startup.jobs/?loc=Preston%2C+Lancashire%2C+United+Kingdom&q=Software&latlng=53.759%2C-2.699&since=30d&page=2';
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const ALGOLIA_DEBUG_COOKIES_PATH = './storage/key_value_stores/default/algolia-debug-cookies.json';

export interface AlgoliaConfig {
    apiKeySearch: string;
    applicationId: string;
    indexPost: string;
}

export { USER_AGENT };
export { ALGOLIA_DEBUG_COOKIES_PATH };

async function saveAlgoliaDebugCookies(url: string, cookies: Awaited<ReturnType<BrowserContext['cookies']>>) {
    const payload = {
        capturedAt: new Date().toISOString(),
        cookieCount: cookies.length,
        cookies,
        url,
    };

    await mkdir(dirname(ALGOLIA_DEBUG_COOKIES_PATH), { recursive: true });
    await writeFile(ALGOLIA_DEBUG_COOKIES_PATH, JSON.stringify(payload, null, 2), 'utf8');
    await Actor.setValue('ALGOLIA_DEBUG_COOKIES', payload);

    log.info('Saved Algolia debug cookies', {
        cookieCount: cookies.length,
        kvsKey: 'ALGOLIA_DEBUG_COOKIES',
        path: ALGOLIA_DEBUG_COOKIES_PATH,
    });
}

function decodeHtmlAttribute(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

export function extractAlgoliaConfig(html: string): AlgoliaConfig {
    const metaByName = new Map<string, string>();

    for (const match of html.matchAll(META_CONTENT_RE)) {
        const [, name, rawContent] = match;
        metaByName.set(name, decodeHtmlAttribute(rawContent));
    }

    const applicationId = metaByName.get('current-algolia-application-id');
    const apiKeySearch = metaByName.get('current-algolia-api-key-search');
    const indexPost = metaByName.get('current-algolia-index-post');

    if (!applicationId || !apiKeySearch || !indexPost) {
        throw new Error(
            `Missing Algolia config fields: ${JSON.stringify({
                applicationId: Boolean(applicationId),
                apiKeySearch: Boolean(apiKeySearch),
                indexPost: Boolean(indexPost),
            })}`,
        );
    }

    return { applicationId, apiKeySearch, indexPost };
}

export async function extractAlgoliaConfigInBrowser(): Promise<AlgoliaConfig> {
    log.info('Launching browser to extract Algolia config', { url: STARTUP_JOBS_URL });
    const browser = await firefox.launch(
        await launchOptions({
            headless: true,
        }),
    );
    const page = await browser.newPage({ userAgent: USER_AGENT });

    try {
        log.info('Opening startup.jobs search page for Algolia config');
        await page.goto(STARTUP_JOBS_URL, { waitUntil: 'domcontentloaded' });
        log.info('Waiting for search input selector to confirm page loaded', { selector: '#alert_query' });
        await page.waitForSelector('#alert_query', { timeout: 30_000 });
        await saveAlgoliaDebugCookies(STARTUP_JOBS_URL, await page.context().cookies());

        const html = await page.content();
        const config = extractAlgoliaConfig(html);
        log.info('Extracted Algolia config from page metadata', {
            applicationId: config.applicationId,
            indexPost: config.indexPost,
        });
        return config;
    } finally {
        await page.close();
        await browser.close();
        log.info('Closed browser used for Algolia config extraction');
    }
}
