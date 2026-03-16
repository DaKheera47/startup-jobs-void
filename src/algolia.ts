import { Actor, log } from 'apify';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSession } from 'wreq-js';

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

interface StoredDebugCookie {
    domain?: string;
    name: string;
    path?: string;
    secure?: boolean;
    value: string;
}

export { USER_AGENT };
export { ALGOLIA_DEBUG_COOKIES_PATH };

async function saveAlgoliaDebugCookies(url: string, cookies: StoredDebugCookie[]) {
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

function toStoredDebugCookies(url: string, cookies: Record<string, string>): StoredDebugCookie[] {
    const { hostname, pathname, protocol } = new URL(url);
    const secure = protocol === 'https:';

    return Object.entries(cookies).map(([name, value]) => ({
        domain: hostname,
        name,
        path: pathname || '/',
        secure,
        value,
    }));
}

export async function extractAlgoliaConfigInBrowser(): Promise<AlgoliaConfig> {
    log.info('Creating wreq session to extract Algolia config', { url: STARTUP_JOBS_URL });
    const session = await createSession({
        browser: 'chrome_136',
        os: 'macos',
        defaultHeaders: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': USER_AGENT,
        },
    });

    try {
        log.info('Opening startup.jobs search page for Algolia config via wreq');
        const response = await session.fetch(STARTUP_JOBS_URL, {
            headers: {
                referer: 'https://startup.jobs/',
                'upgrade-insecure-requests': '1',
            },
            timeout: 60_000,
        });

        if (!response.ok) {
            throw new Error(`startup.jobs bootstrap request failed: ${response.status}`);
        }

        const html = await response.text();
        await saveAlgoliaDebugCookies(STARTUP_JOBS_URL, toStoredDebugCookies(STARTUP_JOBS_URL, session.getCookies(STARTUP_JOBS_URL)));
        const config = extractAlgoliaConfig(html);
        log.info('Extracted Algolia config from page metadata', {
            applicationId: config.applicationId,
            indexPost: config.indexPost,
        });
        return config;
    } finally {
        await session.close();
        log.info('Closed wreq session used for Algolia config extraction');
    }
}
