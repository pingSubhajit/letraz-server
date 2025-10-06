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
	SeedWaitlistParams,
	SeedWaitlistResponse,
	SyncWaitlistToLoopsResponse,
	UpdateWaitlistParams,
	WaitlistResponse
} from '@/services/core/interface'
import {db} from '@/services/core/database'
import {countries, waitlist} from '@/services/core/schema'
import {waitlistAccessGranted, waitlistLoopsSyncTriggered, waitlistSubmitted} from '@/services/core/topics'
import {asc, count, desc, eq, ilike, inArray, sql} from 'drizzle-orm'
import {APIError} from 'encore.dev/api'
import {getPostHogPersonByEmail} from '@/services/analytics/posthog-management'
import {LoopsContact, upsertLoopsContact, WAITLIST_MAILING_LISTS} from '@/services/core/loops'
import log from 'encore.dev/log'

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
	getAllWaitlist: async ({order = 'asc'}: AllWaitlistParams = {}): Promise<AllWaitlistResponse> => {
		const data = await db.select().from(waitlist).orderBy(
			order === 'desc' ? desc(waitlist.waiting_number) : asc(waitlist.waiting_number)
		)

		return {
			waitlists: data
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
	},

	/**
	 * Seed countries from REST Countries API
	 * Fetches all countries and upserts them into the database
	 */
	seedCountries: async (): Promise<{count: number; message: string}> => {
		// Fetch countries from REST Countries API
		const resp = await fetch('https://restcountries.com/v3.1/all?fields=cca3,name')
		if (!resp.ok) {
			throw APIError.internal(`Failed to fetch countries from REST Countries API: ${resp.status}`)
		}

		const data = await resp.json() as Array<{cca3?: string; name?: {common?: string}}>

		// Map to { code, name } and filter invalid entries
		const countriesToSeed = data
			.map((c) => ({
				code: c.cca3?.toUpperCase?.(),
				name: c.name?.common
			}))
			.filter((c): c is {code: string; name: string} => !!c.code && !!c.name)
			.sort((a, b) => a.name.localeCompare(b.name))

		if (countriesToSeed.length === 0) {
			throw APIError.internal('No valid countries fetched from API')
		}

		// Bulk upsert using INSERT ... ON CONFLICT with sql template tag
		const values = countriesToSeed.map((c) => sql`(${c.code}, ${c.name})`)

		await db.execute(sql`
			INSERT INTO countries (code, name)
			VALUES ${sql.join(values, sql`, `)}
			ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
		`)

		return {
			count: countriesToSeed.length,
			message: `Successfully seeded ${countriesToSeed.length} countries`
		}
	},

	/**
	 * Seed waitlist entries from Django migration
	 * Accepts an array of waitlist entries and inserts them into the database
	 * Idempotent - skips entries with emails that already exist
	 * Does NOT publish waitlist-submitted events (for migration purposes only)
	 */
	seedWaitlist: async ({entries}: SeedWaitlistParams): Promise<SeedWaitlistResponse> => {
		if (!entries || entries.length === 0) {
			return {
				count: 0,
				skipped: 0,
				message: 'No entries provided'
			}
		}

		// Validate entries
		const validEntries = entries.filter(entry => entry.id &&
			entry.email &&
			entry.waiting_number !== undefined &&
			entry.created_at &&
			entry.referrer !== undefined &&
			entry.has_access !== undefined)

		if (validEntries.length === 0) {
			throw APIError.invalidArgument('No valid entries provided')
		}

		// Get all emails that already exist in the database
		const emailsToCheck = validEntries.map(e => e.email)
		const existingEntries = await db
			.select({email: waitlist.email})
			.from(waitlist)
			.where(inArray(waitlist.email, emailsToCheck))

		const existingEmails = new Set(existingEntries.map(e => e.email))

		// Filter to only new entries (not in database)
		const newEntries = validEntries.filter(e => !existingEmails.has(e.email))

		if (newEntries.length === 0) {
			return {
				count: 0,
				skipped: validEntries.length,
				message: `All ${validEntries.length} entries already exist`
			}
		}

		// Prepare values for bulk insert
		const valuesToInsert = newEntries.map(entry => ({
			id: entry.id,
			email: entry.email,
			waiting_number: entry.waiting_number,
			created_at: new Date(entry.created_at),
			referrer: entry.referrer,
			has_access: entry.has_access
		}))

		// Bulk insert with ON CONFLICT DO NOTHING for extra safety
		await db
			.insert(waitlist)
			.values(valuesToInsert)
			.onConflictDoNothing({target: waitlist.email})

		const insertedCount = newEntries.length
		const skippedCount = validEntries.length - insertedCount

		return {
			count: insertedCount,
			skipped: skippedCount,
			message: `Successfully seeded ${insertedCount} waitlist entries${skippedCount > 0 ? `, skipped ${skippedCount} existing` : ''}`
		}
	},

	/**
	 * Trigger waitlist sync to Loops (async operation)
	 * Publishes an event that triggers background processing
	 * Returns immediately without waiting for sync to complete
	 */
	syncWaitlistToLoops: async (): Promise<SyncWaitlistToLoopsResponse> => {
		const triggeredAt = new Date().toISOString()

		// Publish event to trigger background processing
		await waitlistLoopsSyncTriggered.publish({
			triggered_at: triggeredAt
		})

		log.info('Waitlist sync to Loops has been queued for background processing')

		return {
			message: 'Waitlist sync to Loops has been queued for background processing. Check logs for progress and results.',
			triggered_at: triggeredAt
		}
	},

	/**
	 * Process waitlist sync to Loops (background worker)
	 * Fetches all waitlist entries and syncs them to Loops in batches with parallel processing
	 * This operation is idempotent - existing contacts in Loops will be updated
	 */
	processWaitlistLoopsSync: async (): Promise<void> => {
		// Fetch all waitlist entries
		const entries = await db.select().from(waitlist).orderBy(asc(waitlist.created_at))

		if (entries.length === 0) {
			log.info('No waitlist entries to sync to Loops')
			return
		}

		log.info('Starting waitlist sync to Loops', {total: entries.length})

		// Configuration for batch processing
		const BATCH_SIZE = 50 // Process 50 entries at a time
		const POSTHOG_CONCURRENCY = 10 // Max 10 concurrent PostHog API calls
		const LOOPS_CONCURRENCY = 10 // Max 10 concurrent Loops API calls

		let totalSynced = 0
		let totalFailed = 0
		const failedEmails: string[] = []

		// Process entries in batches
		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			const batch = entries.slice(i, i + BATCH_SIZE)
			const batchNumber = Math.floor(i / BATCH_SIZE) + 1
			const totalBatches = Math.ceil(entries.length / BATCH_SIZE)

			log.info(`Processing batch ${batchNumber}/${totalBatches}`, {
				size: batch.length,
				progress: `${i + batch.length}/${entries.length}`
			})

			// Build contacts array with PostHog person IDs (parallel with concurrency limit)
			const contacts: LoopsContact[] = []

			// Process PostHog lookups in parallel with concurrency limit
			for (let j = 0; j < batch.length; j += POSTHOG_CONCURRENCY) {
				const chunk = batch.slice(j, j + POSTHOG_CONCURRENCY)

				const chunkResults = await Promise.allSettled(
					chunk.map(async (entry) => {
						try {
							// Try to get PostHog person by email
							const person = await getPostHogPersonByEmail(entry.email)

							// Extract first name and last name from PostHog properties if available
							const firstName = person?.properties?.firstName as string | undefined
							const lastName = person?.properties?.lastName as string | undefined

							return {
								email: entry.email,
								userId: person?.id,
								firstName,
								lastName,
								mailingLists: WAITLIST_MAILING_LISTS
							} as LoopsContact

						} catch (err) {
							log.error('Error fetching PostHog data for waitlist entry', {
								email: entry.email,
								err: String(err)
							})

							// Return contact without PostHog data
							return {
								email: entry.email,
								mailingLists: WAITLIST_MAILING_LISTS
							} as LoopsContact
						}
					})
				)

				// Add successful contacts to the array
				chunkResults.forEach((result) => {
					if (result.status === 'fulfilled') {
						contacts.push(result.value)
					}
				})
			}

			// Sync contacts to Loops with concurrency limit
			for (let k = 0; k < contacts.length; k += LOOPS_CONCURRENCY) {
				const loopsChunk = contacts.slice(k, k + LOOPS_CONCURRENCY)

				const loopsResults = await Promise.allSettled(
					loopsChunk.map(contact => upsertLoopsContact(contact))
				)

				loopsResults.forEach((result, index) => {
					if (result.status === 'fulfilled' && result.value === true) {
						totalSynced++
					} else {
						totalFailed++
						failedEmails.push(loopsChunk[index].email)
					}
				})
			}

			log.info(`Completed batch ${batchNumber}/${totalBatches}`, {
				synced: totalSynced,
				failed: totalFailed
			})
		}

		log.info('Completed waitlist sync to Loops', {
			total: entries.length,
			synced: totalSynced,
			failed: totalFailed,
			failed_emails: failedEmails.length > 0 ? failedEmails.slice(0, 10) : [] // Log first 10 failed emails
		})
	}
}
