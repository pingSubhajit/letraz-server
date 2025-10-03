import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {secret} from 'encore.dev/config'
import {userCreated} from '@/services/identity/topics'
import {jobScrapeFailed, jobScrapeSuccess} from '@/services/job/topics'
import {db} from '@/services/resume/database'
import {ProcessStatus, resumeProcesses, resumes, ResumeSectionType, ResumeStatus} from '@/services/resume/schema'
import {
	resumeTailoringFailed,
	resumeTailoringSuccess,
	resumeTailoringTriggered,
	resumeUpdated,
	thumbnailGenerationTriggered
} from '@/services/resume/topics'
import {BulkReplaceService} from '@/services/resume/services/bulk-replace.service'
import {and, eq} from 'drizzle-orm'
import {ThumbnailEvaluatorService} from './services/thumbnail-evaluator.service'
import {resumeThumbnails} from '@/services/resume/storage'
import {ResumeService} from '@/services/resume/service'
import puppeteer from 'puppeteer'

// Secrets for resume preview URL and authentication
const ResumePreviewUrl = secret('ResumePreviewUrl')
const ResumePreviewToken = secret('ResumePreviewToken')

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
 * Processes resume tailoring requests by generating dummy tailored content
 * TODO: Replace with actual AI-powered resume tailoring
 */
const resumeTailoringTriggeredListener = new Subscription(resumeTailoringTriggered, 'process-resume-tailoring', {
	handler: async (event) => {
		try {
			log.info('Resume tailoring started', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id
			})

			/*
			 * TODO: Replace with actual AI-powered tailoring logic
			 * For now, create dummy tailored resume sections
			 */
			const dummySections = [
				{
					type: ResumeSectionType.Experience,
					data: {
						company_name: 'Tech Company Inc.',
						job_title: 'Senior Software Engineer',
						employment_type: 'Full-Time',
						city: 'San Francisco',
						country_code: 'USA',
						started_from_month: 1,
						started_from_year: 2020,
						finished_at_month: null,
						finished_at_year: null,
						current: true,
						description:
							'Led development of microservices architecture. Implemented CI/CD pipelines. Mentored junior developers.'
					}
				},
				{
					type: ResumeSectionType.Education,
					data: {
						institution_name: 'State University',
						field_of_study: 'Computer Science',
						degree: 'Bachelor of Science',
						country_code: 'USA',
						started_from_month: 9,
						started_from_year: 2015,
						finished_at_month: 5,
						finished_at_year: 2019,
						current: false,
						description: 'Focus on software engineering and distributed systems.'
					}
				},
				{
					type: ResumeSectionType.Skill,
					data: {
						skills: [
							{name: 'TypeScript', category: 'Programming Language', level: 'Expert'},
							{name: 'React', category: 'Framework', level: 'Advanced'},
							{name: 'Node.js', category: 'Runtime', level: 'Expert'}
						]
					}
				}
			]

			// Replace resume sections with dummy tailored content
			await BulkReplaceService.replaceResumeInternal(event.user_id, event.resume_id, dummySections)

			// Update resume status to success
			await db
				.update(resumes)
				.set({
					status: ResumeStatus.Success
				})
				.where(eq(resumes.id, event.resume_id))

			// Update resume process status to success
			await db
				.update(resumeProcesses)
				.set({
					status: ProcessStatus.Success,
					status_details: 'Resume tailored successfully (dummy data)'
				})
				.where(eq(resumeProcesses.id, event.process_id))

			// Publish resume tailoring success event
			await resumeTailoringSuccess.publish({
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id,
				completed_at: new Date()
			})

			// Publish resume updated event for search indexing
			await ResumeService.publishResumeUpdate({
				resumeId: event.resume_id,
				changeType: 'bulk_replace',
				userId: event.user_id
			})

			log.info('Resume tailoring completed successfully', {
				resume_id: event.resume_id,
				job_id: event.job_id,
				process_id: event.process_id,
				user_id: event.user_id
			})
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

				// Update resume process status to failed
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

/**
 * Thumbnail Evaluation Subscription
 * Subscribes to resume update events and evaluates if thumbnail regeneration is needed
 *
 * Process:
 * 1. Receives resumeUpdated event
 * 2. Calculates significance score based on change type and affected fields
 * 3. If score exceeds threshold, publishes thumbnailGenerationTriggered event
 */
const resumeUpdatedListener = new Subscription(resumeUpdated, 'thumbnail-evaluation', {
	handler: async event => {
		await ThumbnailEvaluatorService.processResumeUpdate(event)
	}
})

/**
 * Thumbnail Generation Triggered Listener
 * Subscribes to thumbnail generation triggered events and generates thumbnails
 *
 * Process:
 * 1. Receives thumbnailGenerationTriggered event
 * 2. Fetches dummy image from URL (placeholder for actual thumbnail generation)
 * 3. Uploads image to resume-thumbnails bucket
 * 4. Updates resume record with thumbnail URL
 *
 * This is a fire-and-forget operation with no process tracking in the database.
 */
const thumbnailGenerationTriggeredListener = new Subscription(
	thumbnailGenerationTriggered,
	'generate-thumbnail',
	{
		handler: async event => {
			let browser = null
			try {
				log.info('Thumbnail generation started', {
					resume_id: event.resume_id,
					user_id: event.user_id,
					reason: event.reason,
					change_score: event.change_score
				})

				// Construct the preview URL with authentication token
				const previewUrl = `${ResumePreviewUrl()}/${event.resume_id}?token=${ResumePreviewToken()}`

				log.info('Launching browser for screenshot', {
					resume_id: event.resume_id,
					preview_url: previewUrl.replace(ResumePreviewToken(), '***TOKEN***') // Mask token in logs
				})

				// Launch headless browser
				browser = await puppeteer.launch({
					headless: true,
					args: [
						'--no-sandbox',
						'--disable-setuid-sandbox',
						'--disable-dev-shm-usage',
						'--disable-gpu'
					]
				})

				const page = await browser.newPage()

				// Set viewport to A4 dimensions at 96 DPI
				await page.setViewport({
					width: 794, // A4 width at 96 DPI (210mm)
					height: 1123, // A4 height at 96 DPI (297mm)
					deviceScaleFactor: 1 // Standard DPI for faster rendering
				})

				log.info('Navigating to resume preview page', {
					resume_id: event.resume_id
				})

				// Navigate to the preview page with 30 second timeout
				await page.goto(previewUrl, {
					waitUntil: 'networkidle0',
					timeout: 30000
				})

				log.info('Capturing screenshot', {
					resume_id: event.resume_id
				})

				// Capture screenshot as buffer
				const screenshot = await page.screenshot({
					type: 'png',
					fullPage: false // Only capture the viewport (A4 dimensions)
				})

				// Convert Uint8Array to Buffer
				const imageBuffer = Buffer.from(screenshot)

				// Close browser
				await browser.close()
				browser = null

				log.info('Screenshot captured successfully', {
					resume_id: event.resume_id,
					buffer_size: imageBuffer.length
				})

				// Upload to storage bucket
				const filename = `${event.resume_id}.png`

				await resumeThumbnails.upload(filename, imageBuffer, {
					contentType: 'image/png'
				})

				// Get public URL
				const thumbnailUrl = resumeThumbnails.publicUrl(filename)

				// Update resume record with thumbnail URL
				await db
					.update(resumes)
					.set({
						thumbnail: thumbnailUrl
					})
					.where(eq(resumes.id, event.resume_id))

				// Publish resume updated event for search indexing
				await ResumeService.publishResumeUpdate({
					resumeId: event.resume_id,
					changeType: 'thumbnail_updated',
					userId: event.user_id
				})

				log.info('Thumbnail generation completed successfully', {
					resume_id: event.resume_id,
					user_id: event.user_id,
					thumbnail_url: thumbnailUrl
				})
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error'

				log.error(err as Error, 'Thumbnail generation failed', {
					resume_id: event.resume_id,
					user_id: event.user_id,
					reason: event.reason,
					error: errorMessage
				})

				/*
				 * Fire and forget - no database tracking or failure events
				 * The system will naturally retry on next significant change
				 */
			} finally {
				// Ensure browser is closed even if an error occurred
				if (browser) {
					try {
						await browser.close()
						log.info('Browser closed in cleanup', {
							resume_id: event.resume_id
						})
					} catch (closeErr) {
						log.error(closeErr as Error, 'Failed to close browser in cleanup', {
							resume_id: event.resume_id
						})
					}
				}
			}
		}
	}
)
