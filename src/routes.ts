import { createPlaywrightRouter } from 'crawlee';

export interface StartupJobRecord {
    title: string;
    employer: string;
    employerUrl?: string;
    jobUrl: string;
    applicationLink?: string;
    disciplines?: string;
    deadline?: string;
    salary?: string;
    location?: string;
    degreeRequired?: string;
    starting?: string;
    jobDescription?: string;
}

interface ListingJobRecord {
    company: string | null;
    companyUrl: string | null;
    location: string | null;
    postedAtIso: string | null;
    postedRelative: string | null;
    tags: string[];
    title: string | null;
    url: string | null;
    workplaceType: string | null;
}

interface JobPostingJsonLd {
    '@type'?: string;
    baseSalary?:
        | {
              currency?: string;
              value?:
                  | {
                        unitText?: string;
                        minValue?: number | string;
                        maxValue?: number | string;
                        value?: number | string;
                    }
                  | number
                  | string;
          }
        | string;
    datePosted?: string;
    description?: string;
    employmentType?: string;
    hiringOrganization?:
        | {
              name?: string;
              sameAs?: string;
          }
        | string;
    jobLocation?:
        | {
              address?:
                  | {
                        addressCountry?: string;
                        addressLocality?: string;
                        addressRegion?: string;
                    }
                  | string;
          }
        | Array<{
              address?:
                  | {
                        addressCountry?: string;
                        addressLocality?: string;
                        addressRegion?: string;
                    }
                  | string;
          }>;
    occupationalCategory?: string;
    title?: string;
    validThrough?: string;
}

const BASE_URL = 'https://startup.jobs';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ page, log, pushData, request, enqueueLinks }) => {
    const isJobDetailPage = (await page.locator('body#posts-show').count()) > 0;

    if (isJobDetailPage) {
        const job = await extractJobPage(page, request.loadedUrl ?? request.url);
        log.info('Extracted job detail page', { url: request.loadedUrl ?? request.url, title: job.title });
        await pushData(job);
        return;
    }

    await page.waitForSelector('[data-search-target="hits"] .group\\/post', { timeout: 30_000 });
    const cards = page.locator('[data-search-target="hits"] .group\\/post');
    const cardCount = await cards.count();
    const jobs: ListingJobRecord[] = [];

    for (let index = 0; index < cardCount; index++) {
        const card = cards.nth(index);
        const titleLink = card.locator('[data-mark-visited-links-target="anchor"]').first();
        const visibleRemote = card.locator('[data-post-template-target="workplaceRemote"]:not(.hidden)').first();
        const visibleHybrid = card.locator('[data-post-template-target="workplaceHybrid"]:not(.hidden)').first();
        const tagLocators = card.locator('[data-post-template-target="tags"] a');
        const timeElement = card.locator('time[data-post-template-target="timestamp"]').first();
        const tagCount = await tagLocators.count();
        const tags: string[] = [];
        const companyAnchors = card.locator('a[href^="/company/"]');
        const companyAnchorCount = await companyAnchors.count();
        let company: string | null = null;
        let companyUrl: string | null = null;

        for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
            const tagText = cleanText(await tagLocators.nth(tagIndex).textContent());
            if (tagText) tags.push(tagText);
        }

        for (let companyIndex = 0; companyIndex < companyAnchorCount; companyIndex++) {
            const companyAnchor = companyAnchors.nth(companyIndex);
            const companyText = await getText(companyAnchor);

            if (companyText && !company) {
                company = companyText;
                companyUrl = toAbsoluteUrl(await getHref(companyAnchor));
                break;
            }

            if (!companyUrl) {
                companyUrl = toAbsoluteUrl(await getHref(companyAnchor));
            }
        }

        jobs.push({
            title: await getText(titleLink),
            url: toAbsoluteUrl(await getHref(titleLink)),
            company,
            companyUrl,
            location: await getText(card.locator('[data-post-template-target="location"]').first()),
            workplaceType: (await getText(visibleRemote)) ?? (await getText(visibleHybrid)),
            tags,
            postedRelative: await getText(timeElement),
            postedAtIso: (await timeElement.getAttribute('datetime')) ?? null,
        });
    }

    await enqueueLinks({
        selector: '[data-search-target="hits"] [data-mark-visited-links-target="anchor"]',
        transformRequestFunction: (requestOptions) => {
            const url = requestOptions.url;
            if (!url?.includes('startup.jobs/')) return requestOptions;
            return {
                ...requestOptions,
                url,
                uniqueKey: url,
            };
        },
    });

    log.info(`Extracted ${jobs.length} listing jobs and enqueued detail pages`, { url: request.loadedUrl });

});

async function extractJobPage(
    page: Parameters<Parameters<typeof router.addDefaultHandler>[0]>[0]['page'],
    pageUrl: string,
): Promise<StartupJobRecord> {
    const jsonLd = await extractJobPostingJsonLd(page);

    const title = (await getText(page.locator('h1').first())) ?? jsonLd?.title ?? 'Unknown title';

    const employer =
        (await getText(page.locator('.md\\:hidden a[href^="/company/"]').last())) ??
        (await getText(page.locator('div.bg-black a[href^="/company/"]').last())) ??
        getHiringOrganizationName(jsonLd) ??
        'Unknown employer';

    const companyProfileUrl =
        toAbsoluteUrl(await getHref(page.locator('.md\\:hidden a[href^="/company/"]').last())) ??
        toAbsoluteUrl(await getHref(page.locator('div.bg-black a[href^="/company/"]').last()));

    const employerWebsite =
        toAbsoluteUrl(await getHref(page.locator('a[target="_blank"][rel*="nofollow"][href^="http"]').first())) ??
        getHiringOrganizationUrl(jsonLd);

    const applicationLink =
        toAbsoluteUrl(await getHref(page.locator('a[href^="/apply/"]').first())) ??
        toAbsoluteUrl(await getHref(page.locator('a[rel~="nofollow"][href*="apply"]').first()));

    const descriptionText =
        (await getText(page.locator('.post__content .trix-content').first())) ?? stripHtml(jsonLd?.description) ?? undefined;

    const locationLinks = page.locator('.border-b a[href^="/locations/"]');
    const locationCount = await locationLinks.count();
    const locationParts: string[] = [];
    for (let index = 0; index < locationCount; index++) {
        const part = await getText(locationLinks.nth(index));
        if (part) locationParts.push(part);
    }

    const metaLinks = page.locator('.border-b a');
    const metaLinkCount = await metaLinks.count();
    let workplaceType: string | undefined;
    let employmentType: string | undefined;
    for (let index = 0; index < metaLinkCount; index++) {
        const text = await getText(metaLinks.nth(index));
        if (!text) continue;
        const lower = text.toLowerCase();
        if (!workplaceType && ['remote', 'hybrid', 'on-site', 'onsite'].includes(lower)) {
            workplaceType = text;
        }
        if (!employmentType && /(full-time|part-time|contract|internship|temporary)/i.test(text)) {
            employmentType = text;
        }
    }

    const roleLinks = page.locator('a[href^="/roles/"]');
    const roleLinkCount = await roleLinks.count();
    let roleBreadcrumb: string | undefined;
    for (let index = 0; index < roleLinkCount; index++) {
        const text = await getText(roleLinks.nth(index));
        if (text && text.toLowerCase() !== 'roles') {
            roleBreadcrumb = text;
            break;
        }
    }

    const visibleSalary = await findCardBodyTextByHeading(page, 'Salary');
    const salary = visibleSalary ?? formatSalaryFromJsonLd(jsonLd) ?? undefined;

    const location =
        cleanText(
            [
                locationParts.length > 0 ? locationParts.join(', ') : undefined,
                workplaceType && !locationParts.some((part) => part.toLowerCase() === workplaceType?.toLowerCase())
                    ? workplaceType
                    : undefined,
            ]
                .filter(Boolean)
                .join(' | '),
        ) ??
        buildLocationFromJsonLd(jsonLd) ??
        undefined;

    const disciplines = cleanText(
        [roleBreadcrumb, jsonLd?.occupationalCategory, employmentType ?? normalizeEmploymentType(jsonLd?.employmentType)]
            .filter(Boolean)
            .join(' | '),
    );

    const degreeRequired = extractDegreeRequirement(descriptionText);
    const starting = extractStarting(descriptionText);

    return {
        title,
        employer,
        employerUrl: employerWebsite ?? companyProfileUrl ?? undefined,
        jobUrl: pageUrl,
        applicationLink: applicationLink ?? undefined,
        disciplines: disciplines ?? undefined,
        deadline: cleanText(jsonLd?.validThrough) ?? undefined,
        salary,
        location,
        degreeRequired,
        starting,
        jobDescription: descriptionText,
    };
}

async function extractJobPostingJsonLd(
    page: Parameters<Parameters<typeof router.addDefaultHandler>[0]>[0]['page'],
): Promise<JobPostingJsonLd | undefined> {
    const scripts = page.locator('script[type="application/ld+json"]');
    const scriptCount = await scripts.count();

    for (let index = 0; index < scriptCount; index++) {
        const content = await scripts.nth(index).textContent();
        if (!content || !content.includes('"JobPosting"')) continue;

        try {
            const parsed = JSON.parse(content) as unknown;
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            const match = entries.find(
                (entry): entry is JobPostingJsonLd =>
                    typeof entry === 'object' && entry !== null && (entry as { ['@type']?: string })['@type'] === 'JobPosting',
            );

            if (match) return match;
        } catch {
            continue;
        }
    }

    return undefined;
}

async function findCardBodyTextByHeading(
    page: Parameters<Parameters<typeof router.addDefaultHandler>[0]>[0]['page'],
    heading: string,
): Promise<string | null> {
    const cards = page.locator('div.rounded-lg');
    const cardCount = await cards.count();

    for (let index = 0; index < cardCount; index++) {
        const card = cards.nth(index);
        const title = await getText(card.locator('div.font-bold').first());
        if (title !== heading) continue;

        const body = await getText(card.locator('.dark\\:text-gray-300, .text-yellow-900, .dark\\:text-blue-200').first());
        if (body) return body;
    }

    return null;
}

function getHiringOrganizationName(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    if (!jobPosting?.hiringOrganization) return undefined;
    if (typeof jobPosting.hiringOrganization === 'string') return cleanText(jobPosting.hiringOrganization) ?? undefined;
    return cleanText(jobPosting.hiringOrganization.name) ?? undefined;
}

function getHiringOrganizationUrl(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    if (!jobPosting?.hiringOrganization || typeof jobPosting.hiringOrganization === 'string') return undefined;
    return cleanText(jobPosting.hiringOrganization.sameAs) ?? undefined;
}

function buildLocationFromJsonLd(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    const locationSource = Array.isArray(jobPosting?.jobLocation) ? jobPosting?.jobLocation[0] : jobPosting?.jobLocation;
    if (!locationSource || typeof locationSource !== 'object') return undefined;

    const address = locationSource.address;
    if (!address) return undefined;
    if (typeof address === 'string') return cleanText(address) ?? undefined;

    return (
        cleanText([address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')) ?? undefined
    );
}

function normalizeEmploymentType(value: string | undefined): string | undefined {
    return cleanText(value?.replace(/_/g, '-')) ?? undefined;
}

function formatSalaryFromJsonLd(jobPosting: JobPostingJsonLd | undefined): string | undefined {
    const salary = jobPosting?.baseSalary;
    if (!salary) return undefined;
    if (typeof salary === 'string') return cleanText(salary) ?? undefined;

    const value = salary.value;
    if (typeof value === 'number' || typeof value === 'string') return cleanText(String(value)) ?? undefined;
    if (!value) return undefined;

    const min = toFormattedAmount(value.minValue, salary.currency);
    const max = toFormattedAmount(value.maxValue, salary.currency);
    const exact = toFormattedAmount(value.value, salary.currency);
    const unit = cleanText(value.unitText)?.toLowerCase();
    const unitSuffix = unit ? ` per ${unit}` : '';

    if (exact) return `${exact}${unitSuffix}`;
    if (min && max) return `${min} - ${max}${unitSuffix}`;
    return min ?? max ?? undefined;
}

function toFormattedAmount(value: number | string | undefined, currency: string | undefined): string | undefined {
    if (value == null) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return cleanText(String(value)) ?? undefined;

    return new Intl.NumberFormat('en-US', {
        style: currency ? 'currency' : 'decimal',
        currency: currency || undefined,
        maximumFractionDigits: 0,
    }).format(numeric);
}

function extractDegreeRequirement(description: string | undefined): string | undefined {
    const match = description?.match(
        /\b(?:bachelor['’]?s|master['’]?s|phd|doctorate|degree required|college degree|required degree)[^.:\n]*/i,
    );
    return cleanText(match?.[0]) ?? undefined;
}

function extractStarting(description: string | undefined): string | undefined {
    const startMatch = description?.match(/\b(?:start(?:ing)?|starts?)\b[^.:\n]*/i);
    if (startMatch?.[0]) return cleanText(startMatch[0]) ?? undefined;

    const immediateMatch = description?.match(/\bimmediate(?:ly)?\b[^.:\n]*/i);
    return cleanText(immediateMatch?.[0]) ?? undefined;
}

function stripHtml(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return cleanText(value.replace(/<[^>]+>/g, ' ')) ?? undefined;
}

function cleanText(value: string | null | undefined): string | null {
    const normalized = value?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized ? normalized : null;
}

async function getText(locator: { count(): Promise<number>; first(): { textContent(): Promise<string | null> }; textContent?(): Promise<string | null> }): Promise<string | null> {
    if ((await locator.count()) === 0) return null;

    if (typeof locator.textContent === 'function') {
        return cleanText(await locator.textContent());
    }

    return cleanText(await locator.first().textContent());
}

async function getHref(locator: {
    count(): Promise<number>;
    first(): { getAttribute(name: string): Promise<string | null> };
    getAttribute?(name: string): Promise<string | null>;
}): Promise<string | null> {
    if ((await locator.count()) === 0) return null;

    if (typeof locator.getAttribute === 'function') {
        return (await locator.getAttribute('href')) ?? null;
    }

    return (await locator.first().getAttribute('href')) ?? null;
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
    if (!value) return null;

    try {
        return new URL(value, BASE_URL).toString();
    } catch {
        return null;
    }
}
