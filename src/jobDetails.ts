import { log } from 'apify';
import { load } from 'cheerio';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSession } from 'wreq-js';
import type { Session } from 'wreq-js';

import { ALGOLIA_DEBUG_COOKIES_PATH, USER_AGENT } from './algolia.js';
import type { StartupJobRecord } from './types.js';

const BASE_URL = 'https://startup.jobs';
const DETAIL_BROWSER_PROFILE = 'chrome_124';
const DETAIL_OS_PROFILE = 'macos';
const DETAIL_BROWSER_FALLBACK_TIMEOUT_MS = 60_000;
let browserFallbackPromise: Promise<Awaited<ReturnType<typeof chromium.launch>>> | null = null;

interface StoredDebugCookie {
    domain?: string;
    expires?: number;
    httpOnly?: boolean;
    name: string;
    path?: string;
    sameSite?: string;
    secure?: boolean;
    value: string;
}

interface StoredDebugCookiesPayload {
    capturedAt?: string;
    cookieCount?: number;
    cookies?: StoredDebugCookie[];
    url?: string;
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

export async function createStartupJobsDetailSession(): Promise<Session> {
    const session = await createSession({
        browser: DETAIL_BROWSER_PROFILE,
        os: DETAIL_OS_PROFILE,
        defaultHeaders: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': USER_AGENT,
        },
    });

    await seedSessionWithDebugCookies(session);
    return session;
}

export async function enrichJobRecordFromHtml(session: Session, baseRecord: StartupJobRecord): Promise<StartupJobRecord> {
    const response = await session.fetch(baseRecord.jobUrl, {
        headers: {
            referer: `${BASE_URL}/`,
            'upgrade-insecure-requests': '1',
        },
        timeout: 60_000,
    });

    if (!response.ok) {
        throw new Error(`Job detail request failed: ${response.status}`);
    }

    const html = await response.text();
    return extractJobPageFromHtml(html, baseRecord.jobUrl, baseRecord);
}

export async function enrichJobRecordFromBrowser(baseRecord: StartupJobRecord): Promise<StartupJobRecord> {
    const browser = await getBrowserFallback();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    try {
        const response = await page.goto(baseRecord.jobUrl, {
            timeout: DETAIL_BROWSER_FALLBACK_TIMEOUT_MS,
            waitUntil: 'domcontentloaded',
        });

        if (response && response.status() >= 400) {
            throw new Error(`Browser detail request failed: ${response.status()}`);
        }

        await page.waitForSelector('h1', { timeout: 30_000 });
        const html = await page.content();
        return extractJobPageFromHtml(html, baseRecord.jobUrl, baseRecord);
    } finally {
        await page.close();
        await context.close();
    }
}

export async function closeStartupJobsBrowserFallback(): Promise<void> {
    if (!browserFallbackPromise) return;

    const browserPromise = browserFallbackPromise;
    browserFallbackPromise = null;

    try {
        const browser = await browserPromise;
        await browser.close();
        log.info('Closed Playwright browser used for detail fallback');
    } catch (error) {
        log.warning('Unable to close Playwright browser used for detail fallback', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function seedSessionWithDebugCookies(session: Session): Promise<void> {
    const payload = await readDebugCookiesPayload();
    const cookies = payload?.cookies ?? [];

    if (cookies.length === 0) {
        log.warning('No debug cookies found for startup.jobs detail requests', {
            path: ALGOLIA_DEBUG_COOKIES_PATH,
        });
        return;
    }

    let loadedCount = 0;

    for (const cookie of cookies) {
        if (!cookie.name) continue;
        if (cookie.expires && cookie.expires > 0 && cookie.expires * 1000 < Date.now()) continue;

        try {
            session.setCookie(cookie.name, cookie.value, buildCookieUrl(cookie));
            loadedCount += 1;
        } catch (error) {
            log.debug('Skipping debug cookie that could not be loaded into wreq session', {
                error: error instanceof Error ? error.message : String(error),
                name: cookie.name,
            });
        }
    }

    log.info('Loaded startup.jobs debug cookies into wreq session', {
        availableCookieCount: cookies.length,
        loadedCookieCount: loadedCount,
        path: ALGOLIA_DEBUG_COOKIES_PATH,
    });
}

async function readDebugCookiesPayload(): Promise<StoredDebugCookiesPayload | null> {
    try {
        const raw = await readFile(ALGOLIA_DEBUG_COOKIES_PATH, 'utf8');
        return JSON.parse(raw) as StoredDebugCookiesPayload;
    } catch (error) {
        log.warning('Unable to read saved startup.jobs debug cookies', {
            error: error instanceof Error ? error.message : String(error),
            path: ALGOLIA_DEBUG_COOKIES_PATH,
        });
        return null;
    }
}

async function getBrowserFallback(): Promise<Awaited<ReturnType<typeof chromium.launch>>> {
    if (!browserFallbackPromise) {
        browserFallbackPromise = chromium.launch({ headless: true });
        log.info('Launching Playwright browser for blocked detail-page fallbacks');
    }

    return browserFallbackPromise;
}

function buildCookieUrl(cookie: StoredDebugCookie): string {
    const protocol = cookie.secure === false ? 'http:' : 'https:';
    const hostname = (cookie.domain ?? 'startup.jobs').replace(/^\./, '') || 'startup.jobs';
    const pathname = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
    return new URL(pathname, `${protocol}//${hostname}`).toString();
}

export function extractJobPageFromHtml(
    html: string,
    pageUrl: string,
    baseRecord: StartupJobRecord,
): StartupJobRecord {
    const $ = load(html);
    const jsonLd = extractJobPostingJsonLd($);

    const companyAnchors = $('a[href^="/company/"]');
    const companyAnchor = companyAnchors.last();
    const companyProfileUrl = toAbsoluteUrl(companyAnchor.attr('href')) ?? undefined;
    const employerWebsite =
        cleanText($('a[target="_blank"][rel*="nofollow"][href^="http"]').first().attr('href')) ??
        getHiringOrganizationUrl(jsonLd) ??
        undefined;
    const applicationLink =
        toAbsoluteUrl($('a[href^="/apply/"]').first().attr('href')) ??
        toAbsoluteUrl($('a[rel~="nofollow"][href*="apply"]').first().attr('href')) ??
        undefined;
    const descriptionText =
        cleanText($('.post__content .trix-content').first().text()) ?? stripHtml(jsonLd?.description) ?? baseRecord.jobDescription;

    const locationParts = $('.border-b a[href^="/locations/"]')
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((value): value is string => Boolean(value));

    let workplaceType: string | undefined;
    let employmentType: string | undefined;

    $('.border-b a').each((_, element) => {
        const text = cleanText($(element).text());
        if (!text) return;

        const lower = text.toLowerCase();
        if (!workplaceType && ['remote', 'hybrid', 'on-site', 'onsite'].includes(lower)) {
            workplaceType = text;
        }

        if (!employmentType && /(full-time|part-time|contract|internship|temporary)/i.test(text)) {
            employmentType = text;
        }
    });

    let roleBreadcrumb: string | undefined;
    $('a[href^="/roles/"]').each((_, element) => {
        if (roleBreadcrumb) return;
        const text = cleanText($(element).text());
        if (text && text.toLowerCase() !== 'roles') roleBreadcrumb = text;
    });

    const salary = findSalaryFromCards($) ?? formatSalaryFromJsonLd(jsonLd) ?? baseRecord.salary;
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
        baseRecord.location;
    const disciplines =
        cleanText(
            [roleBreadcrumb, jsonLd?.occupationalCategory, employmentType ?? normalizeEmploymentType(jsonLd?.employmentType)]
                .filter(Boolean)
                .join(' | '),
        ) ?? baseRecord.disciplines;

    return {
        title: cleanText($('h1').first().text()) ?? jsonLd?.title ?? baseRecord.title,
        employer: sanitizeEmployerName(cleanText(companyAnchor.text())) ?? sanitizeEmployerName(getHiringOrganizationName(jsonLd)) ?? baseRecord.employer,
        employerUrl: employerWebsite ?? toAbsoluteUrl(companyAnchor.attr('href')) ?? baseRecord.employerUrl,
        jobUrl: pageUrl,
        applicationLink: applicationLink ?? baseRecord.applicationLink,
        disciplines,
        deadline: cleanText(jsonLd?.validThrough) ?? baseRecord.deadline,
        salary,
        location,
        degreeRequired: extractDegreeRequirement(descriptionText),
        starting: extractStarting(descriptionText),
        jobDescription: descriptionText,
    };
}

function extractJobPostingJsonLd($: ReturnType<typeof load>): JobPostingJsonLd | undefined {
    const scripts = $('script[type="application/ld+json"]').toArray();

    for (const element of scripts) {
        const content = $(element).html();
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

function findSalaryFromCards($: ReturnType<typeof load>): string | undefined {
    let salary: string | undefined;

    $('div.rounded-lg').each((_, element) => {
        if (salary) return;

        const card = $(element);
        const heading = cleanText(card.find('div.font-bold').first().text());
        if (heading !== 'Salary') return;

        salary =
            cleanText(card.find('.dark\\:text-gray-300, .text-yellow-900, .dark\\:text-blue-200').first().text()) ?? undefined;
    });

    return salary;
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

    return cleanText([address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')) ?? undefined;
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

function sanitizeEmployerName(value: string | null | undefined): string | undefined {
    const cleaned = cleanText(value);
    if (!cleaned) return undefined;
    if (/^\{\{\{.*\}\}\}$/.test(cleaned)) return undefined;
    return cleaned;
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
    if (!value) return null;

    try {
        return new URL(value, BASE_URL).toString();
    } catch {
        return null;
    }
}
