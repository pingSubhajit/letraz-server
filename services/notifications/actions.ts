import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {waitlistSubmitted} from '@/services/core/topics'
import {getKnock} from '@/services/notifications/knock'

const _ = new Subscription(waitlistSubmitted, 'add-user-to-knock-from-waitlist', {
	handler: async (event) => {
		const knock = getKnock()
		if (!knock) {
			log.warn('Knock not configured; dropping waitlist_submitted', {email: event.email})
			return
		}

		try {
			await knock.users.update(event.email, {
				email: event.email,
				referrer: event.referrer ?? undefined,
				first_seen_at: event.submittedAt
			})
		} catch (err) {
			log.error(err as Error, 'Failed to upsert user in Knock', {email: event.email})
		}
	}
})
