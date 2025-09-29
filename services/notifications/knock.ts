import {secret} from 'encore.dev/config'
import Knock from '@knocklabs/node'
import {PostHog} from 'posthog-node'
import log from 'encore.dev/log'

const knockApiKey = secret('KnockApiKey')

let client: Knock | null = null

const initClient = (): Knock | null => {
	try {
		const apiKey = knockApiKey()
		if (!apiKey) {
			log.warn('Knock API key not configured; notifications disabled')
			return null
		}
		return new Knock({
			apiKey: apiKey
		})
	} catch (err) {
		log.warn('Failed initializing Knock client; notifications disabled', {err: String(err)})
		return null
	}
}

export const getKnock = (): Knock | null => {
	if (!client) client = initClient()
	return client
}
