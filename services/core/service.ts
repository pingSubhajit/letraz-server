import {
	AddToWaitlistParams,
	AllWaitlistParams,
	AllWaitlistResponse,
	BulkUpdateWaitlistParams,
	BulkUpdateWaitlistResponse,
	Country,
	CreateCountryParams,
	ListCountriesParams,
	ListCountriesResponse,
	UpdateWaitlistParams,
	WaitlistResponse
} from '@/services/core/interface'
import {db} from '@/services/core/database'
import {countries, waitlist} from '@/services/core/schema'
import {waitlistAccessGranted, waitlistSubmitted} from '@/services/core/topics'
import {asc, count, desc, eq, ilike, inArray} from 'drizzle-orm'
import {APIError} from 'encore.dev/api'

export const CoreService = {
	addToWaitlist: async ({email, referrer}: AddToWaitlistParams): Promise<WaitlistResponse> => {
		const lastWaitlist = (await db.select().from(waitlist).orderBy(desc(waitlist.waiting_number)).limit(1))[0]
		let waiting_number = 1

		if (lastWaitlist) {
			waiting_number = lastWaitlist.waiting_number + 1
		}

		const [waitlistEntry] = (await db.insert(waitlist).values({
			email, referrer, waiting_number
		}).returning())

		await waitlistSubmitted.publish({
			email: waitlistEntry.email,
			referrer: waitlistEntry.referrer,
			submittedAt: waitlistEntry.created_at instanceof Date ? waitlistEntry.created_at.toISOString() : new Date().toISOString()
		})
		return waitlistEntry
	},
	getAllWaitlist: async ({page_size = 50, page, order = 'asc'}: AllWaitlistParams = {}): Promise<AllWaitlistResponse> => {
		const limit = Math.min(Math.max(page_size, 1), 200)
		const offset = ((page || 1) - 1) * page_size
		const data = await db.select().from(waitlist).orderBy(
			order === 'desc' ? desc(waitlist.waiting_number) : asc(waitlist.waiting_number)
		).limit(limit).offset(offset)


		const total = (await db.select({count: count()}).from(waitlist))[0].count
		const has_next = offset + page_size < total
		const has_prev = !!offset


		return {
			data,
			page: page || 1,
			page_size: limit,
			total,
			has_next,
			has_prev
		}
	},
	removeFromWaitlist: async (email: string): Promise<void> => {
		await db.delete(waitlist).where(eq(waitlist.email, email))
	},

	/**
	 * Update a waitlist entry by ID
	 * When has_access is changed from false to true, emits waitlist-access-granted event
	 */
	updateWaitlist: async ({id, has_access}: UpdateWaitlistParams): Promise<WaitlistResponse> => {
		// First, fetch the existing entry
		const [existingEntry] = await db.select().from(waitlist).where(eq(waitlist.id, id)).limit(1)

		if (!existingEntry) {
			throw APIError.notFound(`Waitlist entry with id '${id}' not found`)
		}

		// Track if access is being granted
		const accessGranted = !existingEntry.has_access && has_access === true

		// Update the entry
		const [updatedEntry] = await db
			.update(waitlist)
			.set({has_access})
			.where(eq(waitlist.id, id))
			.returning()

		// If access was granted, publish the event
		if (accessGranted) {
			await waitlistAccessGranted.publish({
				id: updatedEntry.id,
				email: updatedEntry.email,
				waiting_number: updatedEntry.waiting_number,
				referrer: updatedEntry.referrer,
				granted_at: new Date().toISOString()
			})
		}

		return updatedEntry
	},

	/**
	 * Bulk update waitlist entries by IDs
	 * Validates all IDs exist before updating. Emits waitlist-access-granted events
	 * for entries where has_access changes from false to true.
	 */
	bulkUpdateWaitlist: async ({waitlist_ids, has_access}: BulkUpdateWaitlistParams): Promise<BulkUpdateWaitlistResponse> => {
		// Validate that waitlist_ids is not empty
		if (!waitlist_ids || waitlist_ids.length === 0) {
			throw APIError.invalidArgument('waitlist_ids cannot be empty')
		}

		// Fetch all existing entries
		const existingEntries = await db
			.select()
			.from(waitlist)
			.where(inArray(waitlist.id, waitlist_ids))

		// Check if all IDs were found
		const foundIds = new Set(existingEntries.map(entry => entry.id))
		const missingIds = waitlist_ids.filter(id => !foundIds.has(id))

		if (missingIds.length > 0) {
			throw APIError.notFound(
				`Some waitlist entries not found. Missing IDs: ${missingIds.join(', ')}`
			)
		}

		// Find entries that will have access granted (currently false, will become true)
		const entriesToGrantAccess = has_access === true
			? existingEntries.filter(entry => !entry.has_access)
			: []

		// Perform bulk update
		await db
			.update(waitlist)
			.set({has_access})
			.where(inArray(waitlist.id, waitlist_ids))

		// Fetch updated entries
		const updatedEntries = await db
			.select()
			.from(waitlist)
			.where(inArray(waitlist.id, waitlist_ids))

		// Emit events for entries that were granted access
		if (entriesToGrantAccess.length > 0) {
			const grantedAt = new Date().toISOString()

			// Publish events for all entries that had access granted
			await Promise.all(
				entriesToGrantAccess.map(entry => waitlistAccessGranted.publish({
					id: entry.id,
					email: entry.email,
					waiting_number: entry.waiting_number,
					referrer: entry.referrer,
					granted_at: grantedAt
				}))
			)
		}

		return {
			updated_count: updatedEntries.length,
			entries: updatedEntries
		}
	},

	/**
	 * Get a country by its ISO 3166-1 alpha-3 code
	 * @param code - ISO 3166-1 alpha-3 code (e.g., 'USA', 'GBR', 'IND')
	 * @returns Country object or throws NotFound error
	 */
	getCountry: async (code: string): Promise<Country> => {
		const country = await db.select().from(countries).where(eq(countries.code, code.toUpperCase())).limit(1)

		if (!country || country.length === 0) {
			throw APIError.notFound(`Country with code '${code}' not found`)
		}

		return country[0]
	},

	/**
	 * List countries with pagination and optional search
	 */
	listCountries: async ({page_size = 50, page, search}: ListCountriesParams = {}): Promise<ListCountriesResponse> => {
		const limit = Math.min(Math.max(page_size, 1), 200)
		const offset = ((page || 1) - 1) * page_size

		// Build query with optional search filter
		const trimmedSearch = search?.trim()
		const baseQuery = db.select().from(countries)
		const data = await (trimmedSearch
			? baseQuery.where(ilike(countries.name, `%${trimmedSearch}%`))
			: baseQuery
		).orderBy(asc(countries.name)).limit(limit).offset(offset)

		// Get total count with same filter
		const countQuery = db.select({count: count()}).from(countries)
		const total = (await (trimmedSearch
			? countQuery.where(ilike(countries.name, `%${trimmedSearch}%`))
			: countQuery
		))[0].count

		const has_next = offset + page_size < total
		const has_prev = !!offset

		return {
			data,
			page: page || 1,
			page_size: limit,
			total,
			has_next,
			has_prev
		}
	},

	/**
	 * Create a new country (internal/admin only)
	 */
	createCountry: async ({code, name}: CreateCountryParams): Promise<Country> => {
		// Normalize code to uppercase
		const normalizedCode = code.toUpperCase()

		// Check if country already exists
		const existing = await db.select().from(countries).where(eq(countries.code, normalizedCode)).limit(1)

		if (existing && existing.length > 0) {
			throw APIError.alreadyExists(`Country with code '${normalizedCode}' already exists`)
		}

		const [country] = await db.insert(countries).values({
			code: normalizedCode,
			name: name.trim()
		}).returning()

		return country
	}
}
