import { createPlaywrightRouter } from 'crawlee';

export interface StartupJobRecord {
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

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ page, log, pushData, request }) => {
    await page.waitForSelector('[data-search-target="hits"] .group\\/post', { timeout: 30_000 });
    const cards = page.locator('[data-search-target="hits"] .group\\/post');
    const cardCount = await cards.count();
    const jobs: StartupJobRecord[] = [];

    const cleanText = (value: string | null | undefined): string | null => {
        const normalized = value?.replace(/\s+/g, ' ').trim();
        return normalized ? normalized : null;
    };

    const getText = async (locator: ReturnType<typeof page.locator>): Promise<string | null> => {
        if ((await locator.count()) === 0) return null;
        return cleanText(await locator.first().textContent());
    };

    const getHref = async (locator: ReturnType<typeof page.locator>): Promise<string | null> => {
        if ((await locator.count()) === 0) return null;
        return (await locator.first().getAttribute('href')) ?? null;
    };

    for (let index = 0; index < cardCount; index++) {
        const card = cards.nth(index);
        const titleLink = card.locator('[data-mark-visited-links-target="anchor"]').first();
        const companyLink = card.locator('a[href^="/company/"]').first();
        const visibleRemote = card.locator('[data-post-template-target="workplaceRemote"]:not(.hidden)').first();
        const visibleHybrid = card.locator('[data-post-template-target="workplaceHybrid"]:not(.hidden)').first();
        const tagLocators = card.locator('[data-post-template-target="tags"] a');
        const timeElement = card.locator('time[data-post-template-target="timestamp"]').first();
        const tagCount = await tagLocators.count();
        const tags: string[] = [];

        for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
            const tagText = cleanText(await tagLocators.nth(tagIndex).textContent());
            if (tagText) tags.push(tagText);
        }

        jobs.push({
            title: await getText(titleLink),
            url: await getHref(titleLink),
            company: await getText(companyLink),
            companyUrl: await getHref(companyLink),
            location: await getText(card.locator('[data-post-template-target="location"]').first()),
            workplaceType: (await getText(visibleRemote)) ?? (await getText(visibleHybrid)),
            tags,
            postedRelative: await getText(timeElement),
            postedAtIso: (await timeElement.getAttribute('datetime')) ?? null,
        });
    }

    log.info(`Extracted ${jobs.length} jobs`, { url: request.loadedUrl });

    await pushData(
        jobs.map((job) => ({
            ...job,
            sourceUrl: request.loadedUrl,
        })),
    );
});
