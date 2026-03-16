# startupjobs

`startupjobs` is a Node.js and TypeScript scraper library for `startup.jobs`. It gives you importable functions for fetching startup job listings, remote jobs, and enriched startup job details, and the same codebase also runs as an Apify Actor.

## Why use it

- Scrape `startup.jobs` from Node.js with a small importable API
- Fetch startup job listings with Algolia-backed search
- Optionally enrich each listing by opening the job detail page
- Reuse the same shared code in local scripts, apps, and an Apify Actor

## Install

```bash
npm install startupjobs
```

Browser binaries are not downloaded automatically on install. If you want detail-page enrichment, install them explicitly:

```bash
npm run browsers:install
```

## Usage

```ts
import { scrapeStartupJobsViaAlgolia } from 'startupjobs';

const jobs = await scrapeStartupJobsViaAlgolia({
  query: 'software engineer',
  requestedCount: 20,
  enrichDetails: true,
});
```

This works well for searches like startup software engineer jobs, design jobs, product jobs, remote startup jobs, and location-filtered startup job listings.

## API

`scrapeStartupJobsViaAlgolia(options)` returns an array of normalized job records.

Supported options include:

- `query`
- `requestedCount`
- `enrichDetails`
- `aroundLatLng`
- `aroundRadius`
- `filters`

When `enrichDetails` is `false`, the library returns records built directly from Algolia hits without loading each job page.

Returned records include fields such as:

- `title`
- `employer`
- `jobUrl`
- `employerUrl`
- `location`
- `salary`
- `disciplines`
- `applicationLink`
- `jobDescription`

## Example output

```ts
[
  {
    title: 'Senior Software Engineer',
    employer: 'Example Startup',
    jobUrl: 'https://startup.jobs/example-job',
    employerUrl: 'https://startup.jobs/company/example-startup',
    location: 'Remote | Europe',
    salary: '$120,000 - $150,000 per year',
    disciplines: 'Engineering | full-time',
    applicationLink: 'https://startup.jobs/apply/example-job',
    jobDescription: '...'
  }
]
```

## Apify Actor

The same codebase can also run as an Apify Actor, so you can use the shared library locally and deploy the actor version separately.

For local actor-style runs:

```bash
npm run actor:start:dev
```

## Keywords

If you found this package while searching for terms like `startup jobs scraper`, `startup.jobs API`, `remote jobs scraper`, `startup job listings`, or `Apify startup.jobs actor`, you’re in the right place.
