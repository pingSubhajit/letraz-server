// schema.ts
import * as p from 'drizzle-orm/pg-core'
import {relations} from 'drizzle-orm'

// Waitlist table (parity with Django CORE.Waitlist)
const waitlist = p.pgTable('waitlist', {
	// UUID primary key (defaults to v4)
	id: p.uuid('id').defaultRandom().primaryKey(),
	// Unique email with max length 254
	email: p.varchar('email', {length: 254}).notNull().unique(),
	// Referrer/source, default 'website', max length 50
	referrer: p.varchar('referrer', {length: 50}).notNull().default('website'),
	// Auto-incrementing waiting number representing join order
	waiting_number: p.integer('waiting_number').default(0).notNull(),
	// Access flag, defaults to false
	has_access: p.boolean('has_access').notNull().default(false),
	// Created timestamp, defaults to now
	created_at: p.timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
})

// Define empty relations to enable typed orm.query API
const waitlistRelations = relations(waitlist, () => ({}))

export {waitlist, waitlistRelations}
