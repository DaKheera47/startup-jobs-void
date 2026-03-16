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

export interface ScrapeOptions {
    aroundLatLng?: string;
    aroundRadius?: string;
    detailConcurrency?: number;
    enrichDetails?: boolean;
    filters?: string;
    requestedCount: number;
    query: string;
}
