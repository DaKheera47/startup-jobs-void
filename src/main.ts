import { Actor, log } from 'apify';

import { normalizeInput } from './input.js';
import { scrapeStartupJobsViaAlgolia } from './startupjobsApi.js';
import type { StartupJobsActorInput } from './input.js';

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
