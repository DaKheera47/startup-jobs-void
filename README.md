# Startup Jobs Scraper

Run the scraper with:

```bash
npm run start:dev
```

You can control the search with environment variables:

- `STARTUPJOBS_QUERY` defaults to `software`
- `STARTUPJOBS_MAX_RESULTS` defaults to `20`
- `STARTUPJOBS_HITS_PER_PAGE` is still accepted as a backward-compatible alias

Example:

```bash
STARTUPJOBS_QUERY=design STARTUPJOBS_MAX_RESULTS=25 npm run start:dev
```

The scraper now makes a single Algolia request and uses the requested result count as `hitsPerPage`, so there is no pagination step.
