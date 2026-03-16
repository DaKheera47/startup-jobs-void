import test from 'node:test';
import assert from 'node:assert/strict';

import { extractAlgoliaConfig } from '../src/algolia.js';

test('extractAlgoliaConfig reads startup.jobs Algolia metadata', () => {
    const html = `
        <html>
            <head>
                <meta name="current-algolia-application-id" content="APP123" />
                <meta name="current-algolia-api-key-search" content="KEY456" />
                <meta name="current-algolia-index-post" content="jobs_prod" />
            </head>
        </html>
    `;

    assert.deepEqual(extractAlgoliaConfig(html), {
        applicationId: 'APP123',
        apiKeySearch: 'KEY456',
        indexPost: 'jobs_prod',
    });
});

test('extractAlgoliaConfig throws when required metadata is missing', () => {
    assert.throws(() => extractAlgoliaConfig('<html><head></head></html>'), /Missing Algolia config fields/);
});
