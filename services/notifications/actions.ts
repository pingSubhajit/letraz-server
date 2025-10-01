import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {waitlistSubmitted} from '@/services/core/topics'
import {getKnock} from '@/services/notifications/knock'
import {userCreated} from '@/services/identity/topics'

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
