import {appMeta} from 'encore.dev'
import {api, APIError} from 'encore.dev/api'
import {
	AddToWaitlistParams,
	WaitlistResponse,
	HealthCheckResponse,
	AllWaitlistResponse, AllWaitlistParams
} from '@/services/core/interface'
import {CoreService} from '@/services/core/service'

/**
 * Core service health check. Returns the operational status and deployment
 * metadata for this service instance, including a status indicator,
 * deployment ID, timestamp, and service name. Publicly exposed at
 * GET /core/health.
 */
export const healthCheck = api({
	method: 'GET', expose: true, path: '/core/health'
}, async (): Promise<HealthCheckResponse> => {
	return {
		status: 'OPERATIONAL',
		instance_id: appMeta().deploy.id,
		timestamp: new Date().toISOString(),
		service: 'core'
	}
})

/**
 * Adds a user to the early access waitlist. Accepts an email and optional
 * referrer and returns the created waitlist record with queue position and
 * access status. Publicly exposed at POST /waitlist.
 */
export const addToWaitlist = api({
	method: 'POST', path: '/waitlist', expose: true
}, async (params: AddToWaitlistParams): Promise<WaitlistResponse> => {
	return CoreService.addToWaitlist(params)
})

/**
 * Lists waitlist entries with pagination. Supports page, page_size, and
 * order (asc|desc). Returns a paginated collection with metadata including
 * total, has_next, and has_prev. Accessible at GET /waitlist.
 */
export const getAllWaitlist = api({
	method: 'GET', path: '/waitlist'
}, async (params: AllWaitlistParams): Promise<AllWaitlistResponse> => {
	return CoreService.getAllWaitlist(params)
})
