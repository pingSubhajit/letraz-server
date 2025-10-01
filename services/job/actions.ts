import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {jobScrapeFailed, jobScrapeTriggered} from '@/services/job/topics'
import {db} from '@/services/job/database'
import {jobs, JobStatus, processes, ProcessStatus} from '@/services/job/schema'
import {eq} from 'drizzle-orm'

const jobScrapeTriggeredEventListener = new Subscription(jobScrapeTriggered, 'extract-job-details', {
	handler: async (event) => {
		try {
			// Simulate job extraction failure
			throw new Error('Job extraction not implemented yet')
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'

			log.error(err as Error, 'Failed to extract job details', {
				job_id: event.job_id,
				process_id: event.process_id
			})

			// Update job status to Failed
			await db
				.update(jobs)
				.set({status: JobStatus.Failure, title: '<EXTRACTION_FAILED>', company_name: '<EXTRACTION_FAILED>'})
				.where(eq(jobs.id, event.job_id))

			// Update process status to Failed
			await db
				.update(processes)
				.set({
					status: ProcessStatus.Failed,
					status_details: errorMessage,
					desc: '<EXTRACTION_FAILED>'
				})
				.where(eq(processes.id, event.process_id))

			// Publish job scrape failed event
			await jobScrapeFailed.publish({
				job_id: event.job_id,
				process_id: event.process_id,
				error_message: errorMessage,
				failed_at: new Date()
			})
		}
	}
})
