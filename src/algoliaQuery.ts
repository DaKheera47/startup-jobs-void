import type { ScrapeOptions } from './types.js';

interface AlgoliaQueryPayload {
    aroundLatLng?: string;
    aroundRadius?: string | number;
    facetFilters: string[][];
    filters: string;
    hitsPerPage: number;
    page?: number;
    query: string;
}

export function buildAlgoliaQueryPayload(options: ScrapeOptions, now = Date.now()): AlgoliaQueryPayload {
    return {
        aroundLatLng: options.aroundLatLng,
        aroundRadius: options.aroundRadius,
        facetFilters: buildFacetFilters(options),
        filters: buildFilters(options, now),
        hitsPerPage: resolveHitsPerPage(options),
        page: resolvePage(options.page),
        query: options.query,
    };
}

function buildFacetFilters(options: ScrapeOptions): string[][] {
    const built = [
        ...mapFacetGroup('workplace_type_id', options.workplaceType),
        ...mapFacetGroup('employment_type', options.employmentType),
        ...mapFacetGroup('experience_bucket', options.experienceBucket),
    ];

    return [...built, ...(options.facetFilters ?? [])];
}

function mapFacetGroup(field: string, values: string[] | undefined): string[][] {
    if (!values?.length) return [];
    return [values.map((value) => `${field}:${value}`)];
}

function buildFilters(options: ScrapeOptions, now: number): string {
    const filters: string[] = [];

    if (options.since) {
        filters.push(`published_at_i >= ${toUnixSeconds(now - sinceToMilliseconds(options.since))}`);
    }
    if (typeof options.hasSalary === 'boolean') {
        filters.push(`has_salary:${options.hasSalary ? 'true' : 'false'}`);
    }
    if (Number.isFinite(options.salaryMinUsd)) {
        filters.push(`salary_max_usd >= ${Number(options.salaryMinUsd)}`);
    }
    if (Number.isFinite(options.salaryMaxUsd)) {
        filters.push(`salary_min_usd <= ${Number(options.salaryMaxUsd)}`);
    }
    if (options.filters?.trim()) {
        filters.push(options.filters.trim());
    }

    return filters.join(' AND ');
}

function sinceToMilliseconds(value: NonNullable<ScrapeOptions['since']>): number {
    switch (value) {
        case '24h':
            return 24 * 60 * 60 * 1000;
        case '7d':
            return 7 * 24 * 60 * 60 * 1000;
        case '30d':
            return 30 * 24 * 60 * 60 * 1000;
    }
}

function toUnixSeconds(value: number): number {
    return Math.floor(value / 1000);
}

function resolveHitsPerPage(options: ScrapeOptions): number {
    const value = options.hitsPerPage ?? options.requestedCount;
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.floor(value));
}

function resolvePage(value: number | undefined): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const numericValue = Number(value);
    return Math.max(0, Math.floor(numericValue));
}
