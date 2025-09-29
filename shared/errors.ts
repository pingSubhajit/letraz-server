import {APIError} from 'encore.dev/api'
import {DrizzleError, DrizzleQueryError} from 'drizzle-orm/errors'
import type {DatabaseError} from 'pg'

/**
 * Translate Drizzle/node-postgres errors into Encore APIError.
 * Returns null if the error is not recognized as a database constraint error.
 */
export const translateDatabaseError = (err: unknown): APIError | null => {
	// If it's a DrizzleQueryError, it should wrap the underlying driver error in cause
	if (err instanceof DrizzleQueryError) {
		const cause = (err as unknown as {cause?: unknown}).cause
		const apiErr = mapPgDatabaseError(cause)
		if (apiErr) return apiErr
	}

	// Some code paths may throw the raw pg DatabaseError
	const apiErr = mapPgDatabaseError(err)
	if (apiErr) return apiErr

	// Other Drizzle errors that are not query errors (typically programming mistakes)
	if (err instanceof DrizzleError) {
		return APIError.internal('Database operation failed')
	}

	return null
}

const mapPgDatabaseError = (err: unknown): APIError | null => {
	const dbErr = err as Partial<DatabaseError> & {code?: string; constraint?: string; detail?: string}
	if (!dbErr || typeof dbErr !== 'object' || !('code' in dbErr)) return null

	switch (dbErr.code) {
		// unique_violation
		case '23505':
			return APIError.alreadyExists('Resource already exists')
		// not_null_violation
		case '23502':
			return APIError.invalidArgument('Missing required field')
		// foreign_key_violation
		case '23503':
			return APIError.failedPrecondition('Related record not found')
		// check_violation
		case '23514':
			return APIError.invalidArgument('Failed validation')
		// string_data_right_truncation (length exceeds limit)
		case '22001':
			return APIError.invalidArgument('Value exceeds allowed length')
		default:
			return APIError.internal('Database error')
	}
}


