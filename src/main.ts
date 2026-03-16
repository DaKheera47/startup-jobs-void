import { Actor, log } from 'apify';

import { scrapeStartupJobsViaAlgolia } from './startupjobsApi.js';
import type { ScrapeOptions } from './types.js';

interface StartupJobsActorInput {
    aroundLatLng?: string;
    aroundRadius?: string;
    detailConcurrency?: number;
    enrichDetails?: boolean;
    filters?: string;
    query?: string;
    requestedCount?: number;
}

function getDefaultInput(): ScrapeOptions {
    const requestedCount = Number(process.env.STARTUPJOBS_MAX_RESULTS ?? '20');
    const detailConcurrency = Number(process.env.STARTUPJOBS_DETAIL_CONCURRENCY ?? '8');

    return {
        query: process.env.STARTUPJOBS_QUERY ?? 'software',
        requestedCount: Number.isFinite(requestedCount) ? requestedCount : 20,
        aroundLatLng: process.env.STARTUPJOBS_AROUND_LAT_LNG?.trim() || undefined,
        aroundRadius: process.env.STARTUPJOBS_AROUND_RADIUS?.trim() || undefined,
        detailConcurrency: Number.isFinite(detailConcurrency) ? detailConcurrency : 8,
        filters: process.env.STARTUPJOBS_FILTERS?.trim() || undefined,
        enrichDetails: true,
    };
}

function normalizeInput(input: StartupJobsActorInput | undefined): ScrapeOptions {
    const defaults = getDefaultInput();

    return {
        query: input?.query?.trim() || defaults.query,
        requestedCount: Number.isFinite(input?.requestedCount) ? Number(input?.requestedCount) : defaults.requestedCount,
        aroundLatLng: input?.aroundLatLng?.trim() || defaults.aroundLatLng,
        aroundRadius: input?.aroundRadius?.trim() || defaults.aroundRadius,
        detailConcurrency: Number.isFinite(input?.detailConcurrency)
            ? Number(input?.detailConcurrency)
            : defaults.detailConcurrency,
        filters: input?.filters?.trim() || defaults.filters,
        enrichDetails: input?.enrichDetails ?? defaults.enrichDetails,
    };
}

await Actor.main(async () => {
    const input = await Actor.getInput<StartupJobsActorInput>();
    log.info('Received actor input', { input: input ?? null });
    const options = normalizeInput(input ?? undefined);
    log.info('Normalized actor options', options);
    log.info('Starting scrape run');
    const records = await scrapeStartupJobsViaAlgolia(options);
    log.info('Scrape finished, pushing records to dataset', { count: records.length });

    await Actor.pushData(records);

    log.info('Stored Startup Jobs records.', {
        count: records.length,
        query: options.query,
    });
});
