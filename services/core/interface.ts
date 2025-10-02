import {IsEmail} from 'encore.dev/validate'
import {PaginatedResponse, PaginationParams} from '@/services/utils/pagination'

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
export interface AllWaitlistParams extends PaginationParams {
	/** Sort order for results by creation time. */
	order?: 'asc' | 'desc'
}

/**
 * Paginated list response for waitlist entries.
 */
export interface AllWaitlistResponse extends PaginatedResponse<WaitlistResponse> {}

/**
 * Event payload for waitlist deletion.
 */
export interface RemoveFromWaitlistParams {
	/** Email address of the user to remove from the waitlist. */
	email: string
}


export interface WaitlistSubmittedEvent {
	email: string
	referrer?: string | null
	submittedAt: string
}

/**
 * Country object representing a country in the system
 */
export interface Country {
	/** ISO 3166-1 alpha-3 code (e.g., 'USA', 'GBR', 'IND') */
	code: string
	/** Full country name */
	name: string
}

/**
 * Request parameters for creating a country
 */
export interface CreateCountryParams {
	/** ISO 3166-1 alpha-3 code */
	code: string
	/** Full country name */
	name: string
}

/**
 * Request parameters for getting a country by code
 */
export interface GetCountryParams {
	/** ISO 3166-1 alpha-3 code */
	code: string
}

/**
 * Query parameters for listing countries
 */
export interface ListCountriesParams extends PaginationParams {
	/** Search query to filter countries by name */
	search?: string
}

/**
 * Paginated list response for countries
 */
export interface ListCountriesResponse extends PaginatedResponse<Country> {}
