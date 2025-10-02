import {
	AddToWaitlistParams,
	AllWaitlistParams,
	AllWaitlistResponse,
	Country,
	CreateCountryParams,
	ListCountriesParams,
	ListCountriesResponse,
	WaitlistResponse
} from '@/services/core/interface'
import {db} from '@/services/core/database'
import {countries, waitlist} from '@/services/core/schema'
import {waitlistSubmitted} from '@/services/core/topics'
import {asc, count, desc, eq, ilike} from 'drizzle-orm'
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
