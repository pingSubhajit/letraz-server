import log from 'encore.dev/log'
import {Subscription} from 'encore.dev/pubsub'
import {getPosthog} from '@/services/analytics/posthog'
import {waitlistSubmitted} from '@/services/core/topics'
import {AnalyticsEventProps} from '@/services/analytics/events'

const _ = new Subscription(waitlistSubmitted, 'track-waitlist-submitted', {
	handler: async (event) => {
		const ph = getPosthog()
		if (!ph) {
			log.warn('PostHog not configured; dropping waitlist_submitted', {email: event.email})
			return
		}
		ph.identify({
			distinctId: event.email,
			properties: {
				email: event.email,
				referrer: event.referrer ?? null,
				first_seen_at: event.submittedAt
			}
		})
		ph.capture({
			distinctId: event.email,
			event: 'waitlist_submitted',
			properties: ({
				referrer: event.referrer ?? undefined
			} satisfies AnalyticsEventProps<'waitlist_submitted'>)
		})
	}
})
