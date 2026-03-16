import type { StartupJobRecord } from './routes.js';
import { extractAlgoliaConfigInBrowser, USER_AGENT } from './algolia.js';

const BASE_URL = 'https://startup.jobs';
const SCRIPT_JSON_LD_RE = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

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

interface JobPostingJsonLd {
    '@graph'?: unknown[];
    '@type'?: string;
    baseSalary?:
        | {
              currency?: string;
              value?:
                  | {
                        unitText?: string;
                        minValue?: number | string;
                        maxValue?: number | string;
                        value?: number | string;
                    }
                  | number
                  | string;
          }
        | string;
    description?: string;
    employmentType?: string;
    hiringOrganization?:
        | {
              name?: string;
              sameAs?: string;
          }
        | string;
    jobLocation?:
        | {
              address?:
                  | {
                        addressCountry?: string;
                        addressLocality?: string;
                        addressRegion?: string;
                    }
                  | string;
          }
        | Array<{
              address?:
                  | {
                        addressCountry?: string;
                        addressLocality?: string;
                        addressRegion?: string;
                    }
                  | string;
          }>;
    occupationalCategory?: string;
    title?: string;
    validThrough?: string;
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

    return mapWithConcurrency(uniqueHits, 5, async (hit) => enrichHit(hit));
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

async function enrichHit(hit: StartupJobsAlgoliaHit): Promise<StartupJobRecord> {
    const baseRecord = buildRecordFromHit(hit);
    if (!baseRecord.jobUrl) return baseRecord;

    const response = await fetch(baseRecord.jobUrl, {
        headers: {
            'user-agent': USER_AGENT,
        },
    });

    if (!response.ok) {
        return baseRecord;
    }

    const html = await response.text();
    const jobPosting = extractJobPostingJsonLdFromHtml(html);
    const description = stripHtml(jobPosting?.description) ?? baseRecord.jobDescription;
    const applicationLink = extractApplicationLinkFromHtml(html);

    return {
        ...baseRecord,
        title: cleanText(jobPosting?.title) ?? baseRecord.title,
        employer: getHiringOrganizationName(jobPosting) ?? baseRecord.employer,
        employerUrl:
            cleanText(getHiringOrganizationUrl(jobPosting)) ??
            extractCompanyProfileUrlFromHtml(html) ??
            baseRecord.employerUrl,
        applicationLink: applicationLink ?? baseRecord.applicationLink,
        disciplines:
            cleanText(
                [baseRecord.disciplines, cleanText(jobPosting?.occupationalCategory), normalizeEmploymentType(jobPosting?.employmentType)]
                    .filter(Boolean)
                    .join(' | '),
            ) ?? baseRecord.disciplines,
        deadline: cleanText(jobPosting?.validThrough) ?? baseRecord.deadline,
        salary: formatSalaryFromJsonLd(jobPosting) ?? baseRecord.salary,
        location: buildLocationFromJsonLd(jobPosting) ?? baseRecord.location,
        degreeRequired: extractDegreeRequirement(description) ?? baseRecord.degreeRequired,
        starting: extractStarting(description) ?? baseRecord.starting,
        jobDescription: description ?? baseRecord.jobDescription,
    };
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

function extractJobPostingJsonLdFromHtml(html: string): JobPostingJsonLd | undefined {
    for (const match of html.matchAll(SCRIPT_JSON_LD_RE)) {
        const raw = cleanText(match[1]);
        if (!raw) continue;

        try {
            const parsed = JSON.parse(raw) as unknown;
            const jobPosting = findJobPosting(parsed);
            if (jobPosting) return jobPosting;
        } catch {
            continue;
        }
    }

    return undefined;
}

function findJobPosting(value: unknown): JobPostingJsonLd | undefined {
    if (Array.isArray(value)) {
        for (const entry of value) {
            const match = findJobPosting(entry);
            if (match) return match;
        }
        return undefined;
    }

    if (!value || typeof value !== 'object') return undefined;

    const candidate = value as JobPostingJsonLd;
    if (candidate['@type'] === 'JobPosting') return candidate;

    if (Array.isArray(candidate['@graph'])) {
        for (const entry of candidate['@graph']) {
            const match = findJobPosting(entry);
            if (match) return match;
        }
    }

    return undefined;
}

function extractApplicationLinkFromHtml(html: string): string | undefined {
    const match = html.match(/href=["']([^"']*\/apply\/[^"']+)["']/i);
    return toAbsoluteUrl(match?.[1]) ?? undefined;
}

function extractCompanyProfileUrlFromHtml(html: string): string | undefined {
    const match = html.match(/href=["']([^"']*\/company\/[^"']+)["']/i);
    return toAbsoluteUrl(match?.[1]) ?? undefined;
}

function getHiringOrganizationName(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    if (!jobPosting?.hiringOrganization) return undefined;
    if (typeof jobPosting.hiringOrganization === 'string') return cleanText(jobPosting.hiringOrganization) ?? undefined;
    return cleanText(jobPosting.hiringOrganization.name) ?? undefined;
}

function getHiringOrganizationUrl(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    if (!jobPosting?.hiringOrganization || typeof jobPosting.hiringOrganization === 'string') return undefined;
    return cleanText(jobPosting.hiringOrganization.sameAs) ?? undefined;
}

function buildLocationFromJsonLd(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    const locationSource = Array.isArray(jobPosting?.jobLocation) ? jobPosting?.jobLocation[0] : jobPosting?.jobLocation;
    if (!locationSource || typeof locationSource !== 'object') return undefined;

    const address = locationSource.address;
    if (!address) return undefined;
    if (typeof address === 'string') return cleanText(address) ?? undefined;

    return (
        cleanText([address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')) ?? undefined
    );
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

function formatSalaryFromJsonLd(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    const salary = jobPosting?.baseSalary;
    if (!salary) return undefined;
    if (typeof salary === 'string') return cleanText(salary) ?? undefined;

    const value = salary.value;
    if (typeof value === 'number' || typeof value === 'string') return cleanText(String(value)) ?? undefined;
    if (!value) return undefined;

    const min = toFormattedAmount(value.minValue, salary.currency);
    const max = toFormattedAmount(value.maxValue, salary.currency);
    const exact = toFormattedAmount(value.value, salary.currency);
    const unit = cleanText(value.unitText)?.toLowerCase();
    const unitSuffix = unit ? ` per ${unit}` : '';

    if (exact) return `${exact}${unitSuffix}`;
    if (min && max) return `${min} - ${max}${unitSuffix}`;
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

function extractDegreeRequirement(description: string | undefined): string | undefined {
    const match = description?.match(
        /\b(?:bachelor['’]?s|master['’]?s|phd|doctorate|degree required|college degree|required degree)[^.:\n]*/i,
    );
    return cleanText(match?.[0]) ?? undefined;
}

function extractStarting(description: string | undefined): string | undefined {
    const startMatch = description?.match(/\b(?:start(?:ing)?|starts?)\b[^.:\n]*/i);
    if (startMatch?.[0]) return cleanText(startMatch[0]) ?? undefined;

    const immediateMatch = description?.match(/\bimmediate(?:ly)?\b[^.:\n]*/i);
    return cleanText(immediateMatch?.[0]) ?? undefined;
}

function stripHtml(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return cleanText(value.replace(/<[^>]+>/g, ' ')) ?? undefined;
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
