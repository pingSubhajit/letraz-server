import {IsEmail} from 'encore.dev/validate'

export interface HealthCheckResponse {
	status: 'OPERATIONAL' | 'DEGRADED' | 'FATAL'
	instance_id: string
	timestamp: string
	service: string
}

export interface AddToWaitlistParams {
	email: string & IsEmail
	referrer?: string
}

export interface WaitlistResponse {
	id: string,
	email: string,
	referrer: string,
	waiting_number: number,
	has_access: boolean,
	created_at: Date
}

export interface AllWaitlistParams {
	page_size?: number
	page?: number
	order?: 'asc' | 'desc'
}

export interface AllWaitlistResponse {
	data: WaitlistResponse[]
	page: number
	page_size: number
	total: number
	has_next: boolean
	has_prev: boolean
}
