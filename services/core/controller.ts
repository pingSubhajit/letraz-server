import {appMeta} from 'encore.dev'
import {api} from 'encore.dev/api'
import {
	AddToWaitlistParams,
	WaitlistResponse,
	HealthCheckResponse,
	AllWaitlistResponse, AllWaitlistParams
} from '@/services/core/interface'
import {CoreService} from '@/services/core/service'

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

export const addToWaitlist = api({
	method: 'POST', path: '/waitlist', expose: true
}, async (params: AddToWaitlistParams): Promise<WaitlistResponse> => {
	return CoreService.addToWaitlist(params)
})

/**
 * Retrieves a specific blog post by its unique ID.
 * This function is publicly accessible and fetches the post's data
 * from the database before returning it to the client.
 */
export const getAllWaitlist = api({
	method: 'GET', path: '/waitlist'
}, async (params: AllWaitlistParams): Promise<AllWaitlistResponse> => {
	return CoreService.getAllWaitlist(params)
})
