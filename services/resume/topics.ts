import {Topic} from 'encore.dev/pubsub'

/**
 * Resume Tailoring Triggered Event
 * Published when a resume tailoring process is initiated
 */
export interface ResumeTailoringTriggeredEvent {
	resume_id: string
	job_id: string
	process_id: string
	user_id: string
	job_url?: string
	triggered_at: Date
}

/**
 * Resume Tailoring Triggered Topic
 */
export const resumeTailoringTriggered = new Topic<ResumeTailoringTriggeredEvent>('resume-tailoring-triggered', {
	deliveryGuarantee: 'at-least-once'
})

/**
 * Resume Tailoring Failed Event
 * Published when a resume tailoring process fails
 */
export interface ResumeTailoringFailedEvent {
	resume_id: string
	job_id: string
	process_id: string
	user_id: string
	error_message: string
	failed_at: Date
}

/**
 * Resume Tailoring Failed Topic
 */
export const resumeTailoringFailed = new Topic<ResumeTailoringFailedEvent>('resume-tailoring-failed', {
	deliveryGuarantee: 'at-least-once'
})

