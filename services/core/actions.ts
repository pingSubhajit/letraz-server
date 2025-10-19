import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {generateObject} from 'ai'
import {z} from 'zod'
import {userCreated} from '@/services/identity/topics'
import {userFeedbackSubmitted, waitlistLoopsSyncTriggered} from '@/services/core/topics'
import {CoreService} from '@/services/core/service'
import {addBreadcrumb, captureException} from '@/services/utils/sentry'
import {AI_MODELS} from '@/services/resume/services/ai-provider.config'

const removeFromWaitlistEventListener = new Subscription(userCreated, 'remove-user-from-waitlist', {
	handler: async (event) => {
		try {
			addBreadcrumb('Removing user from waitlist', {email: event.email}, 'pubsub')
			await CoreService.removeFromWaitlist(event.email)
		} catch (err) {
			log.error(err as Error, 'Failed to remove user from waitlist', {email: event.email})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'waitlist-removal',
					event_type: 'user-created'
				},
				extra: {
					email: event.email,
					user_id: event.id,
					event
				},
				level: 'warning' // Warning since user signup succeeded
			})
		}
	}
})

/**
 * Background worker for syncing waitlist entries to Loops
 * Processes the sync in batches with parallel processing to avoid timeouts
 * Triggered by waitlist-loops-sync-triggered event
 */
const wailistLoopSyncTriggeredListener = new Subscription(waitlistLoopsSyncTriggered, 'sync-waitlist-to-loops-worker', {
	handler: async (event) => {
		try {
			addBreadcrumb('Starting waitlist sync to Loops', {triggered_at: event.triggered_at}, 'pubsub')

			log.info('Processing waitlist sync to Loops', {triggered_at: event.triggered_at})

			// Process the sync in background with batching and parallelism
			await CoreService.processWaitlistLoopsSync()

			log.info('Successfully completed waitlist sync to Loops')

		} catch (err) {
			log.error(err as Error, 'Failed to sync waitlist to Loops', {
				triggered_at: event.triggered_at
			})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'waitlist-loops-sync',
					event_type: 'loops-sync-triggered'
				},
				extra: {
					event
				},
				level: 'error'
			})

			// Throw to trigger retry
			throw err
		}
	}
})

/**
 * Zod Schema for individual feedback item
 * Each feedback item represents a distinct piece of feedback
 */
const FeedbackItemSchema = z.object({
	type: z
		.enum(['general_feedback', 'feature_request', 'help_request'])
		.describe('The category of the feedback: general_feedback for opinions/comments, feature_request for new feature suggestions, help_request for support queries'),
	priority: z
		.enum(['low', 'medium', 'high', 'urgent'])
		.describe('The priority level based on urgency and impact. urgent for critical issues, high for important requests, medium for standard feedback, low for minor suggestions'),
	reformatted_title: z
		.string()
		.describe('A clear, concise title summarizing this specific feedback item in 5-10 words'),
	reformatted_content: z
		.string()
		.describe('A well-structured, professional version of this specific feedback with proper grammar, clear explanation, and actionable details')
})

/**
 * Background worker for processing user feedback
 * Uses AI to categorize, prioritize, and reformat user feedback
 * Triggered by user-feedback-submitted event
 */
const userFeedbackSubmittedListener = new Subscription(userFeedbackSubmitted, 'process-user-feedback', {
	handler: async (event) => {
		try {
			addBreadcrumb('Processing user feedback with AI', {
				user_id: event.user_id,
				has_subject: event.subject !== 'No subject'
			}, 'pubsub')

			log.info('Starting AI-powered feedback analysis', {
				user_id: event.user_id,
				user_email: event.user_email,
				subject: event.subject,
				submitted_at: event.submitted_at
			})

			// Create prompt for AI analysis
			const prompt = `Analyze the following user feedback and identify all distinct feedback items within it.

User Information:
- Name: ${event.user_name}
- Email: ${event.user_email}

Feedback:
Subject: ${event.subject}
Message: ${event.message}

Instructions:
1. Identify each distinct piece of feedback in the message (there may be one or multiple)
2. For each distinct feedback item:
   - Determine its type (general_feedback, feature_request, or help_request)
   - Assess its priority level (low, medium, high, or urgent)
   - Create a clear, concise title that summarizes this specific item
   - Reformat the content to be professional and well-structured

Examples of multiple feedback in one message:
- "I love feature X, but feature Y is broken and I'd also like to see feature Z added"
  → 3 items: general_feedback, help_request, feature_request
- "The dashboard loads slowly and crashes on mobile"
  → 2 items: both help_requests (performance issue, crash issue)

Priority guidelines:
- urgent: Critical bugs, security issues, or blocking problems
- high: Important feature requests, significant user pain points
- medium: Standard feedback, minor improvements
- low: Nice-to-have suggestions, cosmetic issues

If the message contains only one feedback item, return an array with one element.`

			// Use AI to analyze and format the feedback as an array
			const result = await generateObject({
				model: AI_MODELS.anthropic.fast, // Use fast model for quick processing
				output: 'array',
				schema: FeedbackItemSchema,
				prompt,
				temperature: 0.2 // Low temperature for consistent categorization
			})

			const feedbackItems = result.object

			log.info('Feedback analysis completed', {
				user_id: event.user_id,
				total_items: feedbackItems.length,
				types: feedbackItems.map(item => item.type),
				priorities: feedbackItems.map(item => item.priority)
			})

			/*
			 * TODO: Store analyzed feedback in database or forward to support system
			 * For now, we log the structured result
			 */
			feedbackItems.forEach((item, index) => {
				log.info(`Processed feedback item ${index + 1}/${feedbackItems.length}`, {
					user_id: event.user_id,
					user_email: event.user_email,
					user_name: event.user_name,
					original_subject: event.subject,
					original_message: event.message,
					item_index: index + 1,
					total_items: feedbackItems.length,
					analyzed_type: item.type,
					analyzed_priority: item.priority,
					reformatted_title: item.reformatted_title,
					reformatted_content: item.reformatted_content,
					submitted_at: event.submitted_at
				})
			})

		} catch (err) {
			log.error(err as Error, 'Failed to process user feedback', {
				user_id: event.user_id,
				user_email: event.user_email,
				subject: event.subject
			})

			// Report to Sentry for monitoring
			captureException(err, {
				tags: {
					operation: 'feedback-processing',
					event_type: 'user-feedback-submitted'
				},
				extra: {
					event
				},
				level: 'error'
			})

			// Throw to trigger retry
			throw err
		}
	}
})
