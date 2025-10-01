import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {jobScrapeFailed, jobScrapeSuccess, jobScrapeTriggered} from '@/services/job/topics'
import {db} from '@/services/job/database'
import {jobs, JobStatus, processes, ProcessStatus} from '@/services/job/schema'
import {eq} from 'drizzle-orm'

const jobScrapeTriggeredEventListener = new Subscription(jobScrapeTriggered, 'extract-job-details', {
	handler: async (event) => {
		try {
			/*
			 * TODO: Implement actual job extraction logic
			 * For now, populate with dummy data
			 */

			// Dummy job data
			const dummyJobData = {
				title: 'Senior Software Engineer',
				company_name: 'Tech Corp Inc.',
				location: 'San Francisco, CA',
				currency: 'USD',
				salary_min: 120000,
				salary_max: 180000,
				requirements: [
					'5+ years of experience in software development',
					'Strong knowledge of TypeScript and Node.js',
					'Experience with cloud platforms (AWS, GCP, or Azure)',
					'Excellent problem-solving skills'
				],
				description: 'We are looking for a talented Senior Software Engineer to join our growing team. You will be responsible for designing and implementing scalable backend systems.',
				responsibilities: [
					'Design and develop scalable backend services',
					'Collaborate with cross-functional teams',
					'Mentor junior developers',
					'Participate in code reviews'
				],
				benefits: [
					'Competitive salary and equity',
					'Health, dental, and vision insurance',
					'401(k) matching',
					'Flexible work hours and remote work options'
				],
				status: JobStatus.Success
			}

			// Update job with extracted data
			await db
				.update(jobs)
				.set(dummyJobData)
				.where(eq(jobs.id, event.job_id))

			// Update process status to Success
			await db
				.update(processes)
				.set({
					status: ProcessStatus.Success,
					status_details: 'Job extraction completed successfully',
					desc: 'Job extraction completed'
				})
				.where(eq(processes.id, event.process_id))

			// Publish job scrape success event
			await jobScrapeSuccess.publish({
				job_id: event.job_id,
				process_id: event.process_id,
				job_url: event.job_url,
				completed_at: new Date()
			})

			log.info('Job extraction completed successfully', {
				job_id: event.job_id,
				process_id: event.process_id
			})
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
				job_url: event.job_url,
				process_id: event.process_id,
				error_message: errorMessage,
				failed_at: new Date()
			})
		}
	}
})
