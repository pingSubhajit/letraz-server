import {AddToWaitlistParams, AllWaitlistParams, AllWaitlistResponse, WaitlistResponse} from '@/services/core/interface'
import {db} from '@/services/core/database'
import {waitlist} from '@/services/core/schema'
import {waitlistSubmitted} from '@/services/core/topics'
import {asc, count, desc, eq} from 'drizzle-orm'

export const CoreService = {
	addToWaitlist: async ({email, referrer}: AddToWaitlistParams): Promise<WaitlistResponse> => {
		const lastWaitlist = (await db.select().from(waitlist).orderBy(desc(waitlist.waiting_number)).limit(1))[0]
		let waiting_number = 1

		if (lastWaitlist) {
			waiting_number = lastWaitlist.waiting_number + 1
		}

		const inserted = (await db.insert(waitlist).values({
			email, referrer, waiting_number
		}).returning())[0]

		await waitlistSubmitted.publish({
			email: inserted.email,
			referrer: inserted.referrer,
			submittedAt: inserted.created_at instanceof Date ? inserted.created_at.toISOString() : new Date().toISOString()
		})
		return inserted
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
	}
}
