import {Topic} from 'encore.dev/pubsub'
import {WaitlistSubmittedEvent} from '@/services/analytics/interface'

export const waitlistSubmitted = new Topic<WaitlistSubmittedEvent>('waitlist-submitted', {
	deliveryGuarantee: 'at-least-once'
})
