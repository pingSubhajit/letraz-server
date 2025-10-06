import log from 'encore.dev/log'
import {secret} from 'encore.dev/config'
import {captureException} from '@/services/utils/sentry'

const posthogManagementKey = secret('PosthogManagementKey')
const posthogHost = secret('PosthogHost') || 'https://us.i.posthog.com'

/**
 * PostHog Person data structure from management API
 */
interface PostHogPerson {
	id: string
	distinct_ids: string[]
	properties: Record<string, any>
	created_at: string
}

/**
 * PostHog API response for person search
 */
interface PostHogSearchResponse {
	results: PostHogPerson[]
	next?: string | null
}

/**
 * Get a person from PostHog by email
 * Uses the PostHog management API to search for a person by their email
 *
 * @param email - Email address to search for
 * @returns PostHog person object or null if not found
 */
export const getPostHogPersonByEmail = async (email: string): Promise<PostHogPerson | null> => {
	try {
		const apiKey = posthogManagementKey()
		if (!apiKey) {
			log.warn('PostHog management key not configured; person lookup disabled')
			return null
		}

		const host = posthogHost()
		/*
		 * Use the persons API with search filter
		 * PostHog API: GET /api/projects/:project_id/persons/?search=email
		 */
		const url = new URL(`${host}/api/persons/`)
		url.searchParams.set('search', email)

		const response = await fetch(url.toString(), {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})

		if (!response.ok) {
			if (response.status === 404) {
				log.info('Person not found in PostHog', {email})
				return null
			}

			log.error('PostHog API error', {
				status: response.status,
				statusText: response.statusText,
				email
			})

			captureException(new Error(`PostHog API error: ${response.status}`), {
				tags: {
					operation: 'posthog-person-lookup',
					service: 'analytics'
				},
				extra: {
					email,
					status: response.status
				}
			})

			// Return null instead of throwing to make the sync operation resilient
			return null
		}

		const data = await response.json() as PostHogSearchResponse

		if (!data.results || data.results.length === 0) {
			log.info('Person not found in PostHog', {email})
			return null
		}

		// Return the first matching person
		return data.results[0]

	} catch (err) {
		log.error('Failed to get person from PostHog', {
			err: String(err),
			email
		})

		captureException(err, {
			tags: {
				operation: 'posthog-person-lookup',
				service: 'analytics'
			},
			extra: {email}
		})

		// Return null to make the operation resilient
		return null
	}
}

