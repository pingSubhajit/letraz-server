import log from 'encore.dev/log'
import {secret} from 'encore.dev/config'
import {captureException} from '@/services/utils/sentry'

const loopsApiKey = secret('LoopsApiKey')

/**
 * Loops contact data structure
 */
export interface LoopsContact {
	email: string
	userId?: string
	firstName?: string
	lastName?: string
	mailingLists?: Record<string, boolean>
}

/**
 * Loops API response for creating/updating contact
 */
interface LoopsContactResponse {
	success: boolean
	id?: string
	message?: string
}

/**
 * Mailing list IDs for Letraz waitlist subscribers
 * These are the specific lists from the Go implementation
 */
export const WAITLIST_MAILING_LISTS = {
	'cmg1qhuo83cnw0iyrfin309rk': true,
	'cmg1qihwo3g180iyz3nyu5prt': true,
	'cmg1qjtx73cyw0iu7d94d5gm6': true,
	'cmg1qkom33l1s0i0hhnvv91f6': true,
	'cmg1qlw4x3j1l0iw2fkl00tan': true
}

/**
 * Create or update a contact in Loops
 * This operation is idempotent - if the contact already exists, it will be updated
 */
export const upsertLoopsContact = async (contact: LoopsContact): Promise<boolean> => {
	try {
		const apiKey = loopsApiKey()
		if (!apiKey) {
			log.warn('Loops API key not configured; contact sync disabled')
			return false
		}

		// Loops API endpoint for creating/updating contacts
		const url = 'https://app.loops.so/api/v1/contacts/update'

		const response = await fetch(url, {
			method: 'PUT',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(contact)
		})

		if (!response.ok) {
			const errorText = await response.text()
			log.error('Loops API error', {
				status: response.status,
				statusText: response.statusText,
				error: errorText,
				email: contact.email
			})

			captureException(new Error(`Loops API error: ${response.status}`), {
				tags: {
					operation: 'loops-contact-upsert',
					service: 'core'
				},
				extra: {
					email: contact.email,
					status: response.status,
					error: errorText
				}
			})

			return false
		}

		const data = await response.json() as LoopsContactResponse

		if (!data.success) {
			log.error('Loops contact upsert failed', {
				email: contact.email,
				message: data.message
			})
			return false
		}

		log.info('Successfully upserted contact in Loops', {
			email: contact.email,
			userId: contact.userId
		})

		return true

	} catch (err) {
		log.error('Failed to upsert contact in Loops', {
			err: String(err),
			email: contact.email
		})

		captureException(err, {
			tags: {
				operation: 'loops-contact-upsert',
				service: 'core'
			},
			extra: {email: contact.email}
		})

		return false
	}
}

/**
 * Sync multiple contacts to Loops with PostHog user IDs
 */
export const syncContactsToLoops = async (
	contacts: LoopsContact[]
): Promise<{success: number; failed: string[]}> => {
	const results = await Promise.allSettled(
		contacts.map(contact => upsertLoopsContact(contact))
	)

	let successCount = 0
	const failedEmails: string[] = []

	results.forEach((result, index) => {
		if (result.status === 'fulfilled' && result.value === true) {
			successCount++
		} else {
			failedEmails.push(contacts[index].email)
		}
	})

	return {
		success: successCount,
		failed: failedEmails
	}
}

