import { launchOptions } from 'camoufox-js';
import { firefox } from 'playwright';
import type { BrowserContext } from 'playwright';

import type { StartupJobRecord } from './routes.js';
import { extractJobPage } from './routes.js';
import { extractAlgoliaConfigInBrowser, USER_AGENT } from './algolia.js';

const BASE_URL = 'https://startup.jobs';

interface StartupJobsAlgoliaHit {
    _tags?: string[];
    company_name?: string;
    company_slug?: string;
    employment_type?: string;
    location?: string;
    path?: string;
    salary_currency?: string;
    salary_interval?: string;
    salary_max?: number | null;
    salary_min?: number | null;
    title?: string;
    workplace_type_id?: string;
}

interface AlgoliaQueryResponse {
    hits?: StartupJobsAlgoliaHit[];
    nbPages?: number;
    page?: number;
}

interface ScrapeOptions {
    aroundLatLng?: string;
    aroundRadius?: string;
    enrichDetails?: boolean;
    filters?: string;
    hitsPerPage: number;
    maxPages: number;
    query: string;
}

export async function scrapeStartupJobsViaAlgolia(options: ScrapeOptions): Promise<StartupJobRecord[]> {
    const config = await extractAlgoliaConfigInBrowser();
    const pagesToFetch = Math.max(1, options.maxPages);
    const hitsPerPage = Math.max(1, options.hitsPerPage);
    const allHits: StartupJobsAlgoliaHit[] = [];

    for (let page = 0; page < pagesToFetch; page++) {
        const result = await queryAlgoliaPage(config, {
            aroundLatLng: options.aroundLatLng,
            aroundRadius: options.aroundRadius,
            filters: options.filters,
            hitsPerPage,
            page,
            query: options.query,
        });

        allHits.push(...(result.hits ?? []));

        const nbPages = result.nbPages ?? 0;
        if (page + 1 >= nbPages) break;
    }

    const uniqueHits = dedupeHits(allHits);

    if (!options.enrichDetails) {
        return uniqueHits.map((hit) => buildRecordFromHit(hit));
    }

    const browser = await firefox.launch(
        await launchOptions({
            headless: true,
        }),
    );
    const context = await browser.newContext({ userAgent: USER_AGENT });

    try {
        return await mapWithConcurrency(uniqueHits, 5, async (hit) => enrichHit(context, hit));
    } finally {
        await context.close();
        await browser.close();
    }
}

async function queryAlgoliaPage(
    config: Awaited<ReturnType<typeof extractAlgoliaConfigInBrowser>>,
    options: {
        aroundLatLng?: string;
        aroundRadius?: string;
        filters?: string;
        hitsPerPage: number;
        page: number;
        query: string;
    },
): Promise<AlgoliaQueryResponse> {
    const response = await fetch(`https://${config.applicationId}-dsn.algolia.net/1/indexes/${config.indexPost}/query`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': USER_AGENT,
            'x-algolia-api-key': config.apiKeySearch,
            'x-algolia-application-id': config.applicationId,
        },
        body: JSON.stringify({
            aroundLatLng: options.aroundLatLng,
            aroundRadius: options.aroundRadius,
            facetFilters: [],
            filters: options.filters ?? '',
            hitsPerPage: options.hitsPerPage,
            page: options.page,
            query: options.query,
        }),
    });

    if (!response.ok) {
        throw new Error(`Algolia query failed for page ${options.page}: ${response.status}`);
    }

    return (await response.json()) as AlgoliaQueryResponse;
}

async function enrichHit(
    context: BrowserContext,
    hit: StartupJobsAlgoliaHit,
): Promise<StartupJobRecord> {
    const baseRecord = buildRecordFromHit(hit);
    if (!baseRecord.jobUrl) return baseRecord;

    const page = await context.newPage();

    try {
        await page.goto(baseRecord.jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        return await extractJobPage(page, baseRecord.jobUrl);
    } catch (error) {
        console.warn(`Failed to enrich job details for URL ${baseRecord.jobUrl}:`, error);
        return baseRecord;
    } finally {
        await page.close();
    }
}

function buildRecordFromHit(hit: StartupJobsAlgoliaHit): StartupJobRecord {
    const workplaceType = normalizeWorkplaceType(hit.workplace_type_id);
    const employmentType = normalizeEmploymentType(hit.employment_type);
    const location =
        cleanText(
            [hit.location, workplaceType && !containsIgnoreCase(hit.location, workplaceType) ? workplaceType : undefined]
                .filter(Boolean)
                .join(' | '),
        ) ?? undefined;

    return {
        title: cleanText(hit.title) ?? 'Unknown title',
        employer: cleanText(hit.company_name) ?? 'Unknown employer',
        employerUrl: hit.company_slug ? `${BASE_URL}/company/${hit.company_slug}` : undefined,
        jobUrl: toAbsoluteUrl(hit.path) ?? BASE_URL,
        disciplines: cleanText([...(hit._tags ?? []), employmentType].filter(Boolean).join(' | ')) ?? undefined,
        salary: formatSalaryFromHit(hit),
        location,
        jobDescription: undefined,
    };
}

function dedupeHits(hits: StartupJobsAlgoliaHit[]): StartupJobsAlgoliaHit[] {
    const seen = new Set<string>();
    const deduped: StartupJobsAlgoliaHit[] = [];

    for (const hit of hits) {
        const key = hit.path ?? `${hit.company_name}:${hit.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(hit);
    }

    return deduped;
}

function normalizeEmploymentType(value: string | undefined): string | undefined {
    return cleanText(value?.replace(/_/g, '-')) ?? undefined;
}

function normalizeWorkplaceType(value: string | undefined): string | undefined {
    return cleanText(value?.replace(/-/g, ' ')) ?? undefined;
}

function formatSalaryFromHit(hit: StartupJobsAlgoliaHit): string | undefined {
    const min = toFormattedAmount(hit.salary_min, hit.salary_currency);
    const max = toFormattedAmount(hit.salary_max, hit.salary_currency);
    const interval = cleanText(hit.salary_interval);
    const suffix = interval ? ` per ${interval}` : '';

    if (min && max) return `${min} - ${max}${suffix}`;
    return min ?? max ?? undefined;
}

function toFormattedAmount(value: number | string | null | undefined, currency: string | undefined): string | undefined {
    if (value == null) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return cleanText(String(value)) ?? undefined;

    return new Intl.NumberFormat('en-US', {
        style: currency ? 'currency' : 'decimal',
        currency: currency || undefined,
        maximumFractionDigits: 0,
    }).format(numeric);
}

function cleanText(value: string | null | undefined): string | null {
    const normalized = value?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized ? normalized : null;
}

function containsIgnoreCase(haystack: string | undefined, needle: string | undefined): boolean {
    if (!haystack || !needle) return false;
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
    if (!value) return null;

    try {
        return new URL(value, BASE_URL).toString();
    } catch {
        return null;
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(items[currentIndex], currentIndex);
            }
        }),
    );

    return results;
}
