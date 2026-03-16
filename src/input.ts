import type { ScrapeOptions } from './types.js';

interface StartupJobsActorInput {
    aroundLatLng?: string;
    aroundRadius?: number | string;
    detailConcurrency?: number;
    employmentType?: unknown;
    enrichDetails?: boolean;
    experienceBucket?: unknown;
    facetFilters?: unknown;
    filters?: string;
    hasSalary?: boolean;
    hitsPerPage?: number;
    page?: number;
    query?: string;
    requestedCount?: number;
    salaryMaxUsd?: number;
    salaryMinUsd?: number;
    since?: string;
    workplaceType?: unknown;
}

export function getDefaultInput(): ScrapeOptions {
    const requestedCount = Number(process.env.STARTUPJOBS_MAX_RESULTS ?? '20');
    const detailConcurrency = Number(process.env.STARTUPJOBS_DETAIL_CONCURRENCY ?? '8');

    return {
        query: process.env.STARTUPJOBS_QUERY ?? 'software',
        requestedCount: Number.isFinite(requestedCount) ? requestedCount : 20,
        aroundLatLng: process.env.STARTUPJOBS_AROUND_LAT_LNG?.trim() || undefined,
        aroundRadius: normalizeAroundRadius(process.env.STARTUPJOBS_AROUND_RADIUS),
        detailConcurrency: Number.isFinite(detailConcurrency) ? detailConcurrency : 8,
        employmentType: undefined,
        facetFilters: undefined,
        experienceBucket: undefined,
        filters: process.env.STARTUPJOBS_FILTERS?.trim() || undefined,
        hasSalary: undefined,
        hitsPerPage: undefined,
        page: undefined,
        salaryMaxUsd: undefined,
        salaryMinUsd: undefined,
        since: undefined,
        workplaceType: undefined,
        enrichDetails: true,
    };
}

export function normalizeFacetFilters(value: unknown): string[][] | undefined {
    if (!Array.isArray(value)) return undefined;

    const normalized = value
        .map((group) => {
            if (!Array.isArray(group)) return [];
            return group
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter((entry) => entry.length > 0);
        })
        .filter((group) => group.length > 0);

    return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : undefined;
}

export function normalizeAroundRadius(value: unknown): ScrapeOptions['aroundRadius'] {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed === 'all') return 'all';

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
}

export function normalizeInput(input: StartupJobsActorInput | undefined): ScrapeOptions {
    const defaults = getDefaultInput();

    return {
        query: input?.query?.trim() || defaults.query,
        requestedCount: Number.isFinite(input?.requestedCount) ? Number(input?.requestedCount) : defaults.requestedCount,
        aroundLatLng: input?.aroundLatLng?.trim() || defaults.aroundLatLng,
        aroundRadius: normalizeAroundRadius(input?.aroundRadius) ?? defaults.aroundRadius,
        detailConcurrency: Number.isFinite(input?.detailConcurrency)
            ? Number(input?.detailConcurrency)
            : defaults.detailConcurrency,
        employmentType: normalizeStringArray(input?.employmentType) as ScrapeOptions['employmentType'],
        facetFilters: normalizeFacetFilters(input?.facetFilters) ?? defaults.facetFilters,
        experienceBucket: normalizeStringArray(input?.experienceBucket) as ScrapeOptions['experienceBucket'],
        filters: input?.filters?.trim() || defaults.filters,
        hasSalary: typeof input?.hasSalary === 'boolean' ? input.hasSalary : defaults.hasSalary,
        hitsPerPage: Number.isFinite(input?.hitsPerPage) ? Number(input?.hitsPerPage) : defaults.hitsPerPage,
        page: Number.isFinite(input?.page) ? Number(input?.page) : defaults.page,
        salaryMaxUsd: Number.isFinite(input?.salaryMaxUsd) ? Number(input?.salaryMaxUsd) : defaults.salaryMaxUsd,
        salaryMinUsd: Number.isFinite(input?.salaryMinUsd) ? Number(input?.salaryMinUsd) : defaults.salaryMinUsd,
        since: normalizeSince(input?.since) ?? defaults.since,
        workplaceType: normalizeStringArray(input?.workplaceType) as ScrapeOptions['workplaceType'],
        enrichDetails: input?.enrichDetails ?? defaults.enrichDetails,
    };
}

function normalizeSince(value: unknown): ScrapeOptions['since'] {
    if (value !== '24h' && value !== '7d' && value !== '30d') return undefined;
    return value;
}

export type { StartupJobsActorInput };
