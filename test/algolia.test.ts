import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAlgoliaQueryPayload } from '../src/algoliaQuery.js';
import { extractAlgoliaConfig } from '../src/algolia.js';
import { normalizeAroundRadius, normalizeFacetFilters, normalizeInput } from '../src/input.js';

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

test('normalizeFacetFilters keeps valid nested facet filter groups', () => {
    assert.deepEqual(normalizeFacetFilters([['workplace_type_id:remote'], ['has_salary:true']]), [
        ['workplace_type_id:remote'],
        ['has_salary:true'],
    ]);
});

test('normalizeFacetFilters drops invalid and empty entries', () => {
    assert.deepEqual(
        normalizeFacetFilters([
            [' workplace_type_id:remote ', '', 42],
            'employment_type:full-time',
            [],
            ['   ', 'has_salary:true'],
        ]),
        [['workplace_type_id:remote'], ['has_salary:true']],
    );
});

test('normalizeInput includes facetFilters in scrape options', () => {
    assert.deepEqual(
        normalizeInput({
            query: 'engineer',
            requestedCount: 10,
            facetFilters: [['employment_type:full-time'], ['experience_bucket:3-6']],
        }),
        {
            query: 'engineer',
            requestedCount: 10,
            aroundLatLng: undefined,
            aroundRadius: undefined,
            detailConcurrency: 8,
            employmentType: undefined,
            facetFilters: [['employment_type:full-time'], ['experience_bucket:3-6']],
            experienceBucket: undefined,
            filters: undefined,
            hasSalary: undefined,
            hitsPerPage: undefined,
            page: undefined,
            salaryMaxUsd: undefined,
            salaryMinUsd: undefined,
            since: undefined,
            workplaceType: undefined,
            location: undefined,
            enrichDetails: true,
        },
    );
});

test('normalizeInput includes friendly location input in scrape options', () => {
    assert.deepEqual(
        normalizeInput({
            query: 'engineer',
            requestedCount: 10,
            location: 'London, United Kingdom',
        }),
        {
            query: 'engineer',
            requestedCount: 10,
            aroundLatLng: undefined,
            aroundRadius: undefined,
            detailConcurrency: 8,
            employmentType: undefined,
            facetFilters: undefined,
            experienceBucket: undefined,
            filters: undefined,
            hasSalary: undefined,
            hitsPerPage: undefined,
            location: 'London, United Kingdom',
            page: undefined,
            salaryMaxUsd: undefined,
            salaryMinUsd: undefined,
            since: undefined,
            workplaceType: undefined,
            enrichDetails: true,
        },
    );
});

test('normalizeAroundRadius accepts numeric values and all', () => {
    assert.equal(normalizeAroundRadius('25000'), 25000);
    assert.equal(normalizeAroundRadius('all'), 'all');
});

test('buildAlgoliaQueryPayload maps typed filters to Algolia query fields', () => {
    assert.deepEqual(
        buildAlgoliaQueryPayload(
            {
                query: 'engineer',
                requestedCount: 20,
                aroundLatLng: '51.5074,-0.1278',
                aroundRadius: 'all',
                hasSalary: true,
                salaryMinUsd: 100000,
                salaryMaxUsd: 200000,
                since: '7d',
                workplaceType: ['remote', 'hybrid'],
                employmentType: ['full-time'],
                experienceBucket: ['3-6'],
                facetFilters: [['has_salary:true']],
                filters: 'highlighted:true',
                page: 2,
                hitsPerPage: 50,
                enrichDetails: false,
            },
            Date.UTC(2026, 2, 16),
        ),
        {
            query: 'engineer',
            aroundLatLng: '51.5074,-0.1278',
            aroundRadius: 'all',
            facetFilters: [
                ['workplace_type_id:remote', 'workplace_type_id:hybrid'],
                ['employment_type:full-time'],
                ['experience_bucket:3-6'],
                ['has_salary:true'],
            ],
            filters: 'published_at_i >= 1773014400 AND has_salary:true AND salary_max_usd >= 100000 AND salary_min_usd <= 200000 AND highlighted:true',
            hitsPerPage: 50,
            page: 2,
        },
    );
});
