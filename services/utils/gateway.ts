import {Gateway} from 'encore.dev/api'
import {clerkAuth} from '@/services/identity/auth'

/**
 * Global API Gateway
 * Configures authentication using Clerk for all services
 *
 * This gateway is applied globally across all services.
 * Any endpoint with `auth: true` will use this authentication handler.
 */
export const gateway = new Gateway({
	authHandler: clerkAuth
})

