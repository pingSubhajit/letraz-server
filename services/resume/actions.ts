import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {userCreated} from '@/services/identity/topics'
import {db} from '@/services/resume/database'
import {resumes, ResumeStatus} from '@/services/resume/schema'

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

