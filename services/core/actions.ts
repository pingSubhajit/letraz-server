import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {userCreated} from '@/services/identity/topics'
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
