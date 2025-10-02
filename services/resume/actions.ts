import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {userCreated} from '@/services/identity/topics'
import {jobScrapeFailed, jobScrapeSuccess} from '@/services/job/topics'
import {db} from '@/services/resume/database'
import {ProcessStatus, resumeProcesses, resumes, ResumeStatus} from '@/services/resume/schema'
import {resumeTailoringFailed, resumeTailoringTriggered} from '@/services/resume/topics'
import {and, eq} from 'drizzle-orm'

/**
 * User Created Event Listener
 * Automatically creates an empty base resume for newly registered users
 *
 * This subscription listens to the userCreated event from the identity service
 * and ensures every user has a base resume template ready to use.
 */
const userCreatedListener = new Subscription(userCreated, 'create-base-resume', {
	handler: async (event) => {
		try {
			// Create empty base resume for the new user
			const [baseResume] = await db
				.insert(resumes)
				.values({
					user_id: event.id,
					base: true,
					status: ResumeStatus.Success
				})
				.returning()

			log.info('Base resume created for new user', {
				user_id: event.id,
				resume_id: baseResume.id,
				email: event.email
			})
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'

			log.error(err as Error, 'Failed to create base resume for new user', {
				user_id: event.id,
				email: event.email,
				error: errorMessage
			})
		}
	}
})

/**
 * Job Scrape Success Event Listener
 * Triggers resume tailoring for all resumes waiting for this job's scraping to complete
 *
 * This subscription listens to the jobScrapeSuccess event from the job service
 * and publishes resumeTailoringTriggered events for all waiting resumes.
 */
const jobScrapeSuccessListener = new Subscription(jobScrapeSuccess, 'trigger-resume-tailoring', {
	handler: async (event) => {
		try {
			// Find all resumes waiting for this job (status = Processing)
			const waitingResumes = await db
				.select()
				.from(resumes)
				.where(and(eq(resumes.job_id, event.job_id), eq(resumes.status, ResumeStatus.Processing)))

			if (waitingResumes.length === 0) {
				log.info('No resumes waiting for this job', {
					job_id: event.job_id
				})
				return
			}

			log.info('Found resumes waiting for job scraping completion', {
				job_id: event.job_id,
				resume_count: waitingResumes.length
			})

			// Publish tailoring triggered event for each waiting resume
			for (const resume of waitingResumes) {
				try {
					await resumeTailoringTriggered.publish({
						resume_id: resume.id,
						job_id: event.job_id,
						process_id: resume.process_id!,
						user_id: resume.user_id,
						job_url: event.job_url,
						triggered_at: new Date()
					})

					log.info('Resume tailoring triggered event published', {
						resume_id: resume.id,
						job_id: event.job_id,
						user_id: resume.user_id
					})
				} catch (err) {
					const errorMessage = err instanceof Error ? err.message : 'Unknown error'
					log.error(err as Error, 'Failed to publish resume tailoring triggered event', {
						resume_id: resume.id,
						job_id: event.job_id,
						error: errorMessage
					})
				}
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error'
			log.error(err as Error, 'Failed to process job scrape success event', {
				job_id: event.job_id,
				error: errorMessage
			})
		}
	}
})

/**
 * Job Scrape Failed Event Listener
 * Marks all resumes waiting for this job as failed and publishes failure events
 *
 * This subscription listens to the jobScrapeFailed event from the job service
 * and updates the status of all resumes that were waiting for this job.
 */
const jobScrapeFailedListener = new Subscription(jobScrapeFailed, 'mark-resumes-failed', {
	handler: async (event) => {
		try {
			// Find all resumes waiting for this job (status = Processing)
			const waitingResumes = await db
				.select()
				.from(resumes)
				.where(and(eq(resumes.job_id, event.job_id), eq(resumes.status, ResumeStatus.Processing)))

			if (waitingResumes.length === 0) {
				log.info('No resumes waiting for this failed job', {
					job_id: event.job_id
				})
				return
			}

			log.info('Found resumes waiting for failed job, marking as failed', {
				job_id: event.job_id,
				resume_count: waitingResumes.length
			})

			// Update each resume and its process to failed status
			for (const resume of waitingResumes) {
				try {
					// Update resume status
					await db
						.update(resumes)
						.set({
							status: ResumeStatus.Failure
						})
						.where(eq(resumes.id, resume.id))

					// Update resume process status if present
					if (resume.process_id) {
						await db
							.update(resumeProcesses)
							.set({
								status: ProcessStatus.Failed,
								status_details: `Job scraping failed: ${event.error_message}`
							})
							.where(eq(resumeProcesses.id, resume.process_id))
					}

					// Publish resume tailoring failed event
					await resumeTailoringFailed.publish({
						resume_id: resume.id,
						job_id: event.job_id,
						process_id: resume.process_id!,
						user_id: resume.user_id,
						error_message: `Job scraping failed: ${event.error_message}`,
						failed_at: new Date()
					})

					log.info('Resume marked as failed and event published', {
						resume_id: resume.id,
						job_id: event.job_id,
						user_id: resume.user_id
					})
				} catch (err) {
					const errorMessage = err instanceof Error ? err.message : 'Unknown error'
					log.error(err as Error, 'Failed to mark resume as failed', {
						resume_id: resume.id,
						job_id: event.job_id,
						error: errorMessage
					})
				}
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error'
			log.error(err as Error, 'Failed to process job scrape failed event', {
				job_id: event.job_id,
				error: errorMessage
			})
		}
	}
})

/**
 * Resume Tailoring Triggered Event Listener
 * Placeholder handler for resume tailoring - will be implemented in future
 * Currently marks resumes as failed with "not implemented" error
 */
const resumeTailoringTriggeredListener = new Subscription(resumeTailoringTriggered, 'process-resume-tailoring', {
	handler: async (event) => {
		try {
			// TODO: Implement actual resume tailoring logic
			throw new Error('Resume tailoring feature is not implemented yet')
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error'

			log.error(err as Error, 'Resume tailoring failed', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id,
				error: errorMessage
			})

			try {
				// Update resume status to failed
				await db
					.update(resumes)
					.set({
						status: ResumeStatus.Failure
					})
					.where(eq(resumes.id, event.resume_id))

				// Update resume process status if present
				await db
					.update(resumeProcesses)
					.set({
						status: ProcessStatus.Failed,
						status_details: errorMessage
					})
					.where(eq(resumeProcesses.id, event.process_id))

				// Publish resume tailoring failed event
				await resumeTailoringFailed.publish({
					resume_id: event.resume_id,
					job_id: event.job_id,
					process_id: event.process_id,
					user_id: event.user_id,
					error_message: errorMessage,
					failed_at: new Date()
				})

				log.info('Resume marked as failed after tailoring error', {
					resume_id: event.resume_id,
					job_id: event.job_id,
					user_id: event.user_id,
					error: errorMessage
				})
			} catch (cleanupErr) {
				const cleanupErrorMessage = cleanupErr instanceof Error ? cleanupErr.message : 'Unknown error'
				log.error(cleanupErr as Error, 'Failed to clean up resume after tailoring error', {
					resume_id: event.resume_id,
					job_id: event.job_id,
					error: cleanupErrorMessage
				})
			}
		}
	}
})
