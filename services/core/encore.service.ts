import {Service} from 'encore.dev/service'
import {errorHandlingMiddleware} from '@/services/utils/middleware'

/**
 * Core Service
 * Uses shared error handling middleware from services/utils/middleware.ts
 * Authentication is handled globally via the gateway in services/utils/gateway.ts
 */
export default new Service('core', {
	middlewares: [errorHandlingMiddleware]
})
