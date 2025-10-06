import log from 'encore.dev/log'
import {secret} from 'encore.dev/config'
import {captureException} from '@/services/utils/sentry'

const posthogManagementKey = secret('PosthogManagementKey')
const posthogProjectId = secret('PosthogProjectId')
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
 * Uses the PostHog management API to search for a person by their email property
 *
 * @param email - Email address to search for
 * @returns PostHog person object or null if not found
 */
export const getPostHogPersonByEmail = async (email: string): Promise<PostHogPerson | null> => {
	try {
		const apiKey = posthogManagementKey()
		const projectId = posthogProjectId()

		if (!apiKey || !projectId) {
			log.warn('PostHog management key or project ID not configured; person lookup disabled')
			return null
		}

		const host = posthogHost()

		/*
		 * Use the persons API with property filter
		 * PostHog API: GET /api/projects/:project_id/persons/?properties=[{"key":"email","value":"user@example.com","type":"person"}]
		 */
		const url = new URL(`${host}/api/projects/${projectId}/persons/`)
		
		// Build property filter for email search
		const propertyFilter = JSON.stringify([
			{
				key: 'email',
				value: email,
				type: 'person'
			}
		])
		
		url.searchParams.set('properties', propertyFilter)

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

			const errorText = await response.text()
			log.error('PostHog API error', {
				status: response.status,
				statusText: response.statusText,
				error: errorText,
				email
			})

			captureException(new Error(`PostHog API error: ${response.status}`), {
				tags: {
					operation: 'posthog-person-lookup',
					service: 'analytics'
				},
				extra: {
					email,
					status: response.status,
					error: errorText
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
		const person = data.results[0]
		log.info('Found person in PostHog', {
			email,
			person_id: person.id,
			has_firstName: !!person.properties?.firstName,
			has_lastName: !!person.properties?.lastName
		})

		return person

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

