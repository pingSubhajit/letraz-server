import {Topic} from 'encore.dev/pubsub'

/**
 * Job Scrape Triggered Event
 * Published when a job scraping process is initiated
 */
export interface JobScrapeTriggeredEvent {
	job_id: string;
	process_id: string;
	job_url?: string;
	description?: string;
	triggered_at: Date;
}

/**
 * Job Scrape Triggered Topic
 */
export const jobScrapeTriggered = new Topic<JobScrapeTriggeredEvent>('job-scrape-triggered', {
	deliveryGuarantee: 'at-least-once'
})

/**
 * Job Scrape Failed Event
 * Published when a job scraping process fails
 */
export interface JobScrapeFailedEvent {
	job_id: string;
	process_id: string;
	error_message: string;
	failed_at: Date;
}

/**
 * Job Scrape Failed Topic
 */
export const jobScrapeFailed = new Topic<JobScrapeFailedEvent>('job-scrape-failed', {
	deliveryGuarantee: 'at-least-once'
})

