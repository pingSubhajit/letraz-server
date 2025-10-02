import {Service} from 'encore.dev/service'

/**
 * Search Service
 * Handles search indexing and search-related operations
 * - Algolia integration for resume search
 * - Real-time index updates via event subscriptions
 */
export default new Service('search')

