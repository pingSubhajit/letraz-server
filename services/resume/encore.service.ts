import {Service} from 'encore.dev/service'
import {adminPathMiddleware} from '@/services/utils/admin-middleware'

/**
 * Resume Service
 * Manages user resumes, sections, and all related resume data
 *
 * Middlewares:
 * - adminPathMiddleware: Enforces admin API key for /admin/* paths
 */
export default new Service('resume', {
	middlewares: [adminPathMiddleware]
})
