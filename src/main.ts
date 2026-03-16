import { Dataset, log } from 'crawlee';

import { scrapeStartupJobsViaAlgolia } from './startupjobsApi.js';

const DEFAULT_QUERY = process.env.STARTUPJOBS_QUERY ?? 'software';
const DEFAULT_REQUESTED_COUNT = Number(process.env.STARTUPJOBS_MAX_RESULTS ?? '20');

function getOptionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

const records = await scrapeStartupJobsViaAlgolia({
    query: DEFAULT_QUERY,
    requestedCount: Number.isFinite(DEFAULT_REQUESTED_COUNT) ? DEFAULT_REQUESTED_COUNT : 20,
    aroundLatLng: getOptionalEnv('STARTUPJOBS_AROUND_LAT_LNG'),
    aroundRadius: getOptionalEnv('STARTUPJOBS_AROUND_RADIUS'),
    filters: getOptionalEnv('STARTUPJOBS_FILTERS'),
    enrichDetails: true,
});

if (records.length === 0) {
    log.warning('No jobs found for the current Startup Jobs search.');
} else {
    const dataset = await Dataset.open();
    await dataset.pushData(records);
    log.info('Stored Startup Jobs records from Algolia search.', {
        count: records.length,
        query: DEFAULT_QUERY,
    });
}
