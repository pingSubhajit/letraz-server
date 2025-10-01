import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {waitlistSubmitted} from '@/services/core/topics'
import {getKnock} from '@/services/notifications/knock'
import {userCreated} from '@/services/identity/topics'
import {jobScrapeFailed} from '@/services/job/topics'
import {jobs} from '@/services/job/schema'
import {eq} from 'drizzle-orm'
import {db as jobDb} from '@/services/job/database'
import {KnockWorkflows} from '@/services/notifications/workflows'

// Constants
const CLIENT_URL = 'https://app.letraz.com' // TODO: Move to environment config

const waitlistSubmittedEventListener = new Subscription(waitlistSubmitted, 'add-user-to-knock-from-waitlist', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping waitlist-submitted', {email: event.email})
			return
		}

		try {
			await knock.users.update(event.email, {
				email: event.email
			})
		} catch (err) {
			log.error(err as Error, 'Failed to upsert user in Knock', {email: event.email})
		}
	}
})

const userCreatedEventListener = new Subscription(userCreated, 'add-user-to-knock-from-signup', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping user-created')
			return
		}

		try {
			await knock.users.update(event.email, {
				email: event.email,
				name: event.last_name ? `${event.first_name} ${event.last_name}` : event.first_name
			})
		} catch (err) {
			log.error(err as Error, 'Failed to upsert user in Knock', {email: event.email})
		}
	}
})

/**
 * Job Scrape Failed Event Listener
 * Triggers Knock workflow to notify user about failed job scraping
 */
const jobScrapeFailedEventListener = new Subscription(jobScrapeFailed, 'notify-job-scrape-failed', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping job-scrape-failed event', {
				job_id: event.job_id
			})
			return
		}

		try {
			// Fetch the job to get additional details
			const [job] = await jobDb
				.select()
				.from(jobs)
				.where(eq(jobs.id, event.job_id))
				.limit(1)

			if (!job) {
				log.error(new Error('Job not found'), 'Cannot send notification for job-scrape-failed', {
					job_id: event.job_id
				})
				return
			}

			/*
			 * TODO: Add user_id field to jobs table to track job ownership
			 * For now, using job_id as a placeholder - this needs to be replaced
			 * with actual user_id once user tracking is implemented on jobs
			 */
			const userId = event.job_id // TODO: Replace with actual user_id

			await knock.workflows.trigger(KnockWorkflows.JOB_SCRAPE_FAILED, {
				recipients: [userId],
				data: {
					process_id: event.process_id,
					reason: event.error_message,
					cta_url: `${CLIENT_URL}/app?input=true`,
					job_title: job.title !== '<EXTRACTION_FAILED>' ? job.title : null,
					company_name: job.company_name !== '<EXTRACTION_FAILED>' ? job.company_name : null,
					job_url: event.job_url || null
				}
			})

			log.info('Job scrape failed notification sent', {
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: userId
			})
		} catch (err) {
			log.error(err as Error, 'Failed to send job-scrape-failed notification', {
				job_id: event.job_id,
				process_id: event.process_id
			})
		}
	}
})

