import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {userCreated} from '@/services/identity/topics'
import {waitlistLoopsSyncTriggered} from '@/services/core/topics'
import {CoreService} from '@/services/core/service'
import {addBreadcrumb, captureException} from '@/services/utils/sentry'

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
