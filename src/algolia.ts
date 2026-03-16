const META_CONTENT_RE = /<meta\b[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;

export interface AlgoliaConfig {
    apiKeySearch: string;
    applicationId: string;
    indexPost: string;
}

function decodeHtmlAttribute(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

export function extractAlgoliaConfig(html: string): AlgoliaConfig {
    const metaByName = new Map<string, string>();

    for (const match of html.matchAll(META_CONTENT_RE)) {
        const [, name, rawContent] = match;
        metaByName.set(name, decodeHtmlAttribute(rawContent));
    }

    const applicationId = metaByName.get('current-algolia-application-id');
    const apiKeySearch = metaByName.get('current-algolia-api-key-search');
    const indexPost = metaByName.get('current-algolia-index-post');

    if (!applicationId || !apiKeySearch || !indexPost) {
        throw new Error(
            `Missing Algolia config fields: ${JSON.stringify({
                applicationId: Boolean(applicationId),
                apiKeySearch: Boolean(apiKeySearch),
                indexPost: Boolean(indexPost),
            })}`,
        );
    }

    return { applicationId, apiKeySearch, indexPost };
}
