import {Subscription} from 'encore.dev/pubsub'
import log from 'encore.dev/log'
import {userCreated} from '@/services/identity/topics'
import {CoreService} from '@/services/core/service'

const removeFromWaitlistEventListener = new Subscription(userCreated, 'remove-user-from-waitlist', {
	handler: async (event) => {
		try {
			await CoreService.removeFromWaitlist(event.email)
		} catch (err) {
			log.error(err as Error, 'Failed to remove user from waitlist', {email: event.email})
		}
	}
})
