import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {waitlistSubmitted} from '@/services/core/topics'
import {getKnock} from '@/services/notifications/knock'
import {userCreated} from '@/services/identity/topics'
import {resumeTailoringFailed} from '@/services/resume/topics'
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
 * Resume Tailoring Failed Event Listener
 * Triggers Knock workflow to notify user about failed resume tailoring
 * This is what the user actually initiated, so it's the right event to notify on
 */
const resumeTailoringFailedEventListener = new Subscription(resumeTailoringFailed, 'notify-resume-tailoring-failed', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping resume-tailoring-failed event', {
				resume_id: event.resume_id,
				user_id: event.user_id
			})
			return
		}

		try {
			// Fetch the job to get additional context for the notification
			const [job] = await jobDb
				.select()
				.from(jobs)
				.where(eq(jobs.id, event.job_id))
				.limit(1)

			if (!job) {
				log.error(new Error('Job not found'), 'Cannot send notification for resume-tailoring-failed', {
					job_id: event.job_id,
					resume_id: event.resume_id
				})
				return
			}

			await knock.workflows.trigger(KnockWorkflows.JOB_SCRAPE_FAILED, {
				recipients: [event.user_id],
				data: {
					resume_id: event.resume_id,
					process_id: event.process_id,
					reason: event.error_message,
					cta_url: `${CLIENT_URL}/app?input=true`,
					job_title: job.title !== '<EXTRACTION_FAILED>' ? job.title : null,
					company_name: job.company_name !== '<EXTRACTION_FAILED>' ? job.company_name : null,
					failed_at: event.failed_at.toISOString()
				}
			})

			log.info('Resume tailoring failed notification sent', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id
			})
		} catch (err) {
			log.error(err as Error, 'Failed to send resume-tailoring-failed notification', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id
			})
		}
	}
})

