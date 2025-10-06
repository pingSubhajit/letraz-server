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
export interface AllWaitlistParams {
	/** Sort order for results by creation time. */
	order?: 'asc' | 'desc'
}

/**
 * Paginated list response for waitlist entries.
 */
export interface AllWaitlistResponse {
	waitlists: WaitlistResponse[]
}

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
 * Request parameters for updating a waitlist entry
 */
export interface UpdateWaitlistParams {
	/** Waitlist entry ID */
	id: string
	/** Whether the user has been granted access */
	has_access?: boolean
}

/**
 * Request parameters for bulk updating waitlist entries
 */
export interface BulkUpdateWaitlistParams {
	/** List of waitlist entry IDs to update */
	waitlist_ids: string[]
	/** Whether to grant or revoke access for the selected users */
	has_access: boolean
}

/**
 * Response for bulk update waitlist operation
 */
export interface BulkUpdateWaitlistResponse {
	/** Number of entries updated */
	updated_count: number
	/** Updated waitlist entries */
	entries: WaitlistResponse[]
}

/**
 * Event payload published when a waitlist user is granted access
 */
export interface WaitlistAccessGrantedEvent {
	/** Waitlist entry ID */
	id: string
	/** Email of the user granted access */
	email: string
	/** Sequential position in the waitlist */
	waiting_number: number
	/** Referrer/source of the waitlist entry */
	referrer: string
	/** Timestamp when access was granted */
	granted_at: string
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
 * Response for seed countries operation
 */
export interface SeedCountriesResponse {
	/** Number of countries seeded */
	count: number
	/** Message describing the operation result */
	message: string
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

/**
 * Individual waitlist entry for seeding from Django migration
 */
export interface SeedWaitlistEntry {
	/** UUID from Django database */
	id: string
	/** Email address */
	email: string
	/** Waiting number/position */
	waiting_number: number
	/** Created timestamp (ISO 8601 string) */
	created_at: string
	/** Referrer/source */
	referrer: string
	/** Whether user has access */
	has_access: boolean
}

/**
 * Request parameters for seeding waitlist entries
 */
export interface SeedWaitlistParams {
	/** Array of waitlist entries to seed */
	entries: SeedWaitlistEntry[]
}

/**
 * Response for seed waitlist operation
 */
export interface SeedWaitlistResponse {
	/** Number of entries seeded */
	count: number
	/** Number of entries skipped (already existed) */
	skipped: number
	/** Message describing the operation result */
	message: string
}

/**
 * Response for sync waitlist to Loops operation
 */
export interface SyncWaitlistToLoopsResponse {
	/** Message indicating sync has been queued */
	message: string
	/** Timestamp when the sync was triggered */
	triggered_at: string
}

/**
 * Event payload published when waitlist sync to Loops is triggered
 */
export interface WaitlistLoopsSyncTriggeredEvent {
	/** Timestamp when the sync was triggered */
	triggered_at: string
	/** Optional admin identifier who triggered the sync */
	triggered_by?: string
}
