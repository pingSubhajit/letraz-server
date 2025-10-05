import log from 'encore.dev/log'
import type {ClerkWebhookPayload} from '@/services/webhooks/interface'
import {userDeleted} from '@/services/webhooks/topics'

/**
 * Webhooks Service
 * Business logic for handling webhook events
 */
export const WebhooksService = {
	/**
	 * Process Clerk webhook event
	 * Handles different event types from Clerk
	 */
	processClerkWebhook: async (payload: ClerkWebhookPayload): Promise<void> => {
		log.info('Processing Clerk webhook', {
			event_type: payload.type,
			user_id: payload.data?.id,
			timestamp: payload.timestamp
		})

		// Handle user.deleted event
		if (payload.type === 'user.deleted') {
			await WebhooksService.handleUserDeleted(payload)
		}

		// Add other event handlers here as needed
	},

	/**
	 * Handle user.deleted event from Clerk
	 * Publishes a user-deleted event to the pub/sub system
	 */
	handleUserDeleted: async (payload: ClerkWebhookPayload): Promise<void> => {
		const userId = payload.data.id

		if (!userId) {
			throw new Error('Missing user ID in user.deleted event')
		}

		log.info('Processing user deletion', {
			user_id: userId,
			timestamp: payload.timestamp
		})

		// Publish user-deleted event
		await userDeleted.publish({
			user_id: userId,
			deleted_at: new Date(payload.timestamp),
			source: 'clerk'
		})

		log.info('Published user-deleted event', {
			user_id: userId
		})
	}
}
