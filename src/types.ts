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

export type AroundRadius = number | 'all';
export type SinceWindow = '24h' | '7d' | '30d';
export type WorkplaceType = 'remote' | 'hybrid' | 'on-site';
export type EmploymentType = 'full-time' | 'contractor' | 'internship' | 'part-time';
export type ExperienceBucket = '0-1' | '1-3' | '3-6' | '6+';

export interface ScrapeOptions {
    aroundLatLng?: string;
    aroundRadius?: AroundRadius;
    detailConcurrency?: number;
    enrichDetails?: boolean;
    experienceBucket?: ExperienceBucket[];
    facetFilters?: string[][];
    filters?: string;
    hasSalary?: boolean;
    hitsPerPage?: number;
    location?: string;
    page?: number;
    salaryMaxUsd?: number;
    salaryMinUsd?: number;
    since?: SinceWindow;
    workplaceType?: WorkplaceType[];
    employmentType?: EmploymentType[];
    requestedCount: number;
    query: string;
}
