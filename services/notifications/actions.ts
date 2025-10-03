import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {waitlistAccessGranted, waitlistSubmitted} from '@/services/core/topics'
import {getKnock} from '@/services/notifications/knock'
import {userCreated} from '@/services/identity/topics'
import {resumeTailoringFailed, resumeTailoringSuccess} from '@/services/resume/topics'
import {jobs} from '@/services/job/schema'
import {eq} from 'drizzle-orm'
import {db as jobDb} from '@/services/job/database'
import {KnockWorkflows} from '@/services/notifications/workflows'
import {secret} from 'encore.dev/config'
import {addBreadcrumb, captureException} from '@/services/utils/sentry'

// Constants
const CLIENT_URL = secret('ClientUrl')()

const waitlistSubmittedEventListener = new Subscription(waitlistSubmitted, 'add-user-to-knock-from-waitlist', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping waitlist-submitted', {email: event.email})
			return
		}

		try {
			addBreadcrumb('Adding waitlist user to Knock', {email: event.email}, 'pubsub')
			await knock.users.update(event.email, {
				email: event.email
			})
		} catch (err) {
			log.error(err as Error, 'Failed to upsert user in Knock', {email: event.email})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'knock-user-upsert',
					event_type: 'waitlist-submitted'
				},
				extra: {
					email: event.email,
					event
				},
				level: 'error'
			})
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
			addBreadcrumb('Adding new user to Knock', {email: event.email}, 'pubsub')
			await knock.users.update(event.email, {
				email: event.email,
				name: event.last_name ? `${event.first_name} ${event.last_name}` : event.first_name
			})
		} catch (err) {
			log.error(err as Error, 'Failed to upsert user in Knock', {email: event.email})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'knock-user-upsert',
					event_type: 'user-created'
				},
				extra: {
					email: event.email,
					user_id: event.id,
					event
				},
				level: 'error'
			})
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

			await knock.workflows.trigger(KnockWorkflows.RESUME_TAILORED_FAILED, {
				recipients: [event.user_id],
				data: {
					resume_id: event.resume_id,
					job_id: event.job_id,
					reason: event.error_message,
					report_url: `${CLIENT_URL}/app/support?resumeId=${event.resume_id}`,
					job_title: job?.title !== '<EXTRACTION_FAILED>' ? job.title : null,
					company_name: job?.company_name !== '<EXTRACTION_FAILED>' ? job.company_name : null
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

/**
 * Resume Tailoring Success Event Listener
 * Triggers Knock workflow to notify user about successful resume tailoring
 */
const resumeTailoringSuccessEventListener = new Subscription(resumeTailoringSuccess, 'notify-resume-tailoring-success', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping resume-tailoring-success event', {
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
				log.warn('Job not found for resume tailoring success notification', {
					job_id: event.job_id,
					resume_id: event.resume_id
				})
				// Continue anyway - notification can work without job details
			}

			// Trigger Knock workflow for resume tailoring success
			await knock.workflows.trigger(KnockWorkflows.RESUME_TAILORED, {
				recipients: [event.user_id],
				data: {
					resume_id: event.resume_id,
					job_id: event.job_id,
					cta_url: `${CLIENT_URL}/app/craft/resumes/${event.resume_id}`,
					job_title: job?.title !== '<EXTRACTION_FAILED>' ? job.title : null,
					company_name: job?.company_name !== '<EXTRACTION_FAILED>' ? job.company_name : null
				}
			})

			log.info('Resume tailoring success notification sent', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id,
				job_title: job?.title,
				company_name: job?.company_name
			})
		} catch (err) {
			log.error(err as Error, 'Failed to process resume-tailoring-success event', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id
			})
		}
	}
})

/**
 * Waitlist Access Granted Event Listener
 * Triggers Knock workflow to send welcome-flow when user is granted access
 */
const waitlistAccessGrantedEventListener = new Subscription(waitlistAccessGranted, 'trigger-welcome-flow', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping waitlist-access-granted event', {
				waitlist_id: event.id,
				email: event.email
			})
			return
		}

		try {
			addBreadcrumb('Triggering welcome-flow workflow', {
				waitlist_id: event.id,
				email: event.email
			}, 'pubsub')

			/*
			 * Trigger the welcome-flow workflow
			 * Use the waitlist entry ID as the user ID for Knock
			 */
			await knock.workflows.trigger(KnockWorkflows.WELCOME_FLOW, {
				recipients: [event.email],
				data: {
					email: event.email,
					waiting_number: event.waiting_number,
					referrer: event.referrer
				}
			})

			log.info('Welcome-flow workflow triggered successfully', {
				waitlist_id: event.id,
				email: event.email,
				waiting_number: event.waiting_number
			})
		} catch (err) {
			log.error(err as Error, 'Failed to trigger welcome-flow workflow', {
				waitlist_id: event.id,
				email: event.email
			})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'knock-workflow-trigger',
					event_type: 'waitlist-access-granted',
					workflow: 'welcome-flow'
				},
				extra: {
					waitlist_id: event.id,
					email: event.email,
					event
				},
				level: 'error'
			})
		}
	}
})

