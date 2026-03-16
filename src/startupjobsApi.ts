import { log } from 'apify';

import type { ScrapeOptions, StartupJobRecord } from './types.js';
import { extractAlgoliaConfigInBrowser, USER_AGENT } from './algolia.js';
import { createStartupJobsDetailSession, enrichJobRecordFromHtml } from './jobDetails.js';

const BASE_URL = 'https://startup.jobs';
const DEFAULT_DETAIL_ENRICHMENT_CONCURRENCY = 8;
const MAX_DETAIL_ENRICHMENT_CONCURRENCY = 16;

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

export async function scrapeStartupJobsViaAlgolia(options: ScrapeOptions): Promise<StartupJobRecord[]> {
    const detailConcurrency = resolveDetailConcurrency(options.detailConcurrency);
    log.info('Starting startup.jobs scrape via Algolia', {
        detailConcurrency,
        enrichDetails: options.enrichDetails,
        query: options.query,
        requestedCount: options.requestedCount,
    });
    const config = await extractAlgoliaConfigInBrowser();
    const requestedCount = Math.max(1, options.requestedCount);
    log.info('Querying Algolia for startup.jobs hits', {
        aroundLatLng: options.aroundLatLng,
        aroundRadius: options.aroundRadius,
        filters: options.filters,
        hitsPerPage: requestedCount,
        query: options.query,
    });
    const result = await queryAlgolia(config, {
        aroundLatLng: options.aroundLatLng,
        aroundRadius: options.aroundRadius,
        filters: options.filters,
        hitsPerPage: requestedCount,
        query: options.query,
    });
    const uniqueHits = dedupeHits(result.hits ?? []);
    log.info('Received Algolia results', {
        page: result.page,
        totalHits: result.hits?.length ?? 0,
        uniqueHits: uniqueHits.length,
    });

    if (!options.enrichDetails) {
        log.info('Skipping detail enrichment and returning Algolia hit records only');
        return uniqueHits.map((hit) => buildRecordFromHit(hit));
    }

    log.info('Creating wreq session for detail-page enrichment', { totalJobs: uniqueHits.length });
    const detailSession = await createStartupJobsDetailSession();

    try {
        return await mapWithConcurrency(uniqueHits, detailConcurrency, async (hit) => enrichHit(detailSession, hit));
    } finally {
        await detailSession.close();
        log.info('Closed wreq session used for detail-page enrichment');
    }
}

async function queryAlgolia(
    config: Awaited<ReturnType<typeof extractAlgoliaConfigInBrowser>>,
    options: {
        aroundLatLng?: string;
        aroundRadius?: string;
        filters?: string;
        hitsPerPage: number;
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
            query: options.query,
        }),
    });

    if (!response.ok) {
        throw new Error(`Algolia query failed: ${response.status}`);
    }

    const parsed = (await response.json()) as AlgoliaQueryResponse;
    log.info('Algolia query completed successfully', {
        hits: parsed.hits?.length ?? 0,
        nbPages: parsed.nbPages,
        page: parsed.page,
    });
    return parsed;
}

async function enrichHit(
    detailSession: Awaited<ReturnType<typeof createStartupJobsDetailSession>>,
    hit: StartupJobsAlgoliaHit,
): Promise<StartupJobRecord> {
    const baseRecord = buildRecordFromHit(hit);
    if (!baseRecord.jobUrl) return baseRecord;

    log.info('Fetching job detail page via wreq', { url: baseRecord.jobUrl });

    try {
        const enriched = await enrichJobRecordFromHtml(detailSession, baseRecord);
        log.info('Extracted job detail page successfully', { title: enriched.title, url: baseRecord.jobUrl });
        return enriched;
    } catch (error) {
        log.warning('Failed to enrich job details; returning base Algolia record', {
            error: error instanceof Error ? error.message : String(error),
            url: baseRecord.jobUrl,
        });
        return baseRecord;
    }
}

function buildRecordFromHit(hit: StartupJobsAlgoliaHit): StartupJobRecord {
    const workplaceType = normalizeWorkplaceType(hit.workplace_type_id);
    const employmentType = normalizeEmploymentType(hit.employment_type);
    const employer = sanitizeEmployerName(hit.company_name);
    const location =
        cleanText(
            [hit.location, workplaceType && !containsIgnoreCase(hit.location, workplaceType) ? workplaceType : undefined]
                .filter(Boolean)
                .join(' | '),
        ) ?? undefined;

    return {
        title: cleanText(hit.title) ?? 'Unknown title',
        employer: employer ?? 'Unknown employer',
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

function resolveDetailConcurrency(value: number | undefined): number {
    if (value == null || !Number.isFinite(value)) return DEFAULT_DETAIL_ENRICHMENT_CONCURRENCY;
    return Math.max(1, Math.min(MAX_DETAIL_ENRICHMENT_CONCURRENCY, Math.floor(value)));
}

function sanitizeEmployerName(value: string | undefined): string | undefined {
    const cleaned = cleanText(value);
    if (!cleaned) return undefined;
    if (/^\{\{\{.*\}\}\}$/.test(cleaned)) return undefined;
    return cleaned;
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
    let completed = 0;

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(items[currentIndex], currentIndex);
                completed += 1;
                log.info('Completed job processing progress', {
                    completed,
                    total: items.length,
                });
            }
        }),
    );

    return results;
}
