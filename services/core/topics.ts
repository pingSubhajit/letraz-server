import {Topic} from 'encore.dev/pubsub'
import {WaitlistAccessGrantedEvent, WaitlistSubmittedEvent, WaitlistLoopsSyncTriggeredEvent} from '@/services/core/interface'

export const waitlistSubmitted = new Topic<WaitlistSubmittedEvent>('waitlist-submitted', {
	deliveryGuarantee: 'at-least-once'
})

export const waitlistAccessGranted = new Topic<WaitlistAccessGrantedEvent>('waitlist-access-granted', {
	deliveryGuarantee: 'at-least-once'
})

export const waitlistLoopsSyncTriggered = new Topic<WaitlistLoopsSyncTriggeredEvent>('waitlist-loops-sync-triggered', {
	deliveryGuarantee: 'at-least-once'
})
