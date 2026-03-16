# startupjobs

Importable library functions for scraping listings and job details from `startup.jobs`.

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

## API

`scrapeStartupJobsViaAlgolia(options)` returns an array of normalized job records.

Supported options:

- `query`
- `requestedCount`
- `enrichDetails`
- `aroundLatLng`
- `aroundRadius`
- `filters`

When `enrichDetails` is `false`, the library returns records built directly from Algolia hits without loading each job page.

## Apify Actor

The same codebase can also run as an Apify Actor. The actor entrypoint lives in [src/main.ts](/Users/ssarfaraz/coding/scraping/startupjobs/src/main.ts) and forwards actor input into the shared library.

For local actor-style runs:

```bash
npm run actor:start:dev
```
