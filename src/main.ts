// For more information, see https://crawlee.dev/
import { launchOptions } from 'camoufox-js';
import { PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

import { router } from './routes.js';

const startUrls = ['https://startup.jobs/?q=software'];
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const crawler = new PlaywrightCrawler({
    requestHandler: router,
    maxRequestsPerCrawl: 100,
    browserPoolOptions: {
        // Disable the default fingerprint spoofing to avoid conflicts with Camoufox.
        useFingerprints: false,
    },
    launchContext: {
        launcher: firefox,
        launchOptions: await launchOptions({
            headless: true,
            // Pass your own Camoufox parameters here...
            // block_images: true,
            // fonts: ['Times New Roman'],
            // ...
        }),
        userAgent: USER_AGENT,
    },
});

await crawler.run(startUrls);
