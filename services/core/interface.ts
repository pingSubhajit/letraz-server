import {IsEmail} from 'encore.dev/validate'

/**
 * Health check response payload returned by GET /core/health.
 * Describes current service state and metadata at the time of request.
 */
export interface HealthCheckResponse {
	/** Service availability status. */
	status: 'OPERATIONAL' | 'DEGRADED' | 'FATAL'
	/** Unique deployment identifier for this service instance. */
	instance_id: string
	/** ISO-8601 UTC timestamp when the status was generated. */
	timestamp: string
	/** Name of the service providing the health check. */
	service: string
}

/**
 * Request body for adding an email to the waitlist.
 */
export interface AddToWaitlistParams {
	/** User's email address. Must be a valid email. */
	email: string & IsEmail
	/** Optional referral source identifier or URL. */
	referrer?: string
}

/**
 * Waitlist entry object created/returned by the API.
 */
export interface WaitlistResponse {
	/** Unique identifier of the waitlist entry. */
	id: string,
	/** Email associated with the entry. */
	email: string,
	/** Recorded referrer, if any. */
	referrer: string,
	/** Sequential position in the waitlist. */
	waiting_number: number,
	/** Whether the user has been granted access. */
	has_access: boolean,
	/** Creation timestamp of the entry. */
	created_at: Date
}

/**
 * Query parameters for listing waitlist entries.
 */
export interface AllWaitlistParams {
	/** Page size (number of items per page). */
	page_size?: number
	/** 1-based page index. */
	page?: number
	/** Sort order for results by creation time. */
	order?: 'asc' | 'desc'
}

/**
 * Paginated list response for waitlist entries.
 */
export interface AllWaitlistResponse {
	/** Waitlist entries for the requested page. */
	data: WaitlistResponse[]
	/** Current page index. */
	page: number
	/** Page size used when fetching results. */
	page_size: number
	/** Total number of entries available. */
	total: number
	/** Whether there is a subsequent page. */
	has_next: boolean
	/** Whether there is a previous page. */
	has_prev: boolean
}
