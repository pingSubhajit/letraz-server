import {eq} from 'drizzle-orm'
import type {CreateUserInput, UpdateUserInput, User} from './interface'
import {APIError} from 'encore.dev/api'
import {users} from '@/services/identity/schema'
import {db} from '@/services/identity/database'

/**
 * Identity Service
 * Provides user identity management and CRUD operations
 */
export const IdentityService = {
	/**
	 * Get or Create User
	 * Retrieves a user by ID or creates a new one if it doesn't exist
	 */
	getOrCreateUser: async (
		userId: string,
		userInfo?: {
			email: string
			first_name: string
			last_name?: string | null
			last_login?: Date | null
		}
	): Promise<{user: User; created: boolean}> => {
		// Try to find existing user
		const existingUser = await db.query.users.findFirst({
			where: eq(users.id, userId)
		})

		if (existingUser) {
			return {
				user: existingUser as User,
				created: false
			}
		}

		// Create new user
		if (!userInfo) {
			throw APIError.internal('User info required to create new user')
		}

		const [newUser] = await db
			.insert(users)
			.values({
				id: userId,
				email: userInfo.email,
				first_name: userInfo.first_name,
				last_name: userInfo.last_name || null,
				last_login: userInfo.last_login || null,
				is_active: true,
				is_staff: false
			})
			.returning()

		return {
			user: newUser as User,
			created: true
		}
	},

	/**
	 * Get User by ID
	 */
	getUserById: async (userId: string): Promise<User | null> => {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId)
		})

		return user ? (user as User) : null
	},

	/**
	 * Get User by Email
	 */
	getUserByEmail: async (email: string): Promise<User | null> => {
		const user = await db.query.users.findFirst({
			where: eq(users.email, email)
		})

		return user ? (user as User) : null
	},

	/**
	 * Update User
	 */
	updateUser: async (userId: string, data: UpdateUserInput): Promise<User> => {
		const [updatedUser] = await db.update(users).set(data).where(eq(users.id, userId)).returning()

		if (!updatedUser) {
			throw APIError.notFound(`User with ID ${userId} not found`)
		}

		return updatedUser as User
	},

	/**
	 * Create User
	 */
	createUser: async (data: CreateUserInput): Promise<User> => {
		const [newUser] = await db
			.insert(users)
			.values({
				...data,
				is_active: true,
				is_staff: false
			})
			.returning()

		return newUser as User
	},

	/**
	 * Delete User
	 */
	deleteUser: async (userId: string): Promise<void> => {
		const result = await db.delete(users).where(eq(users.id, userId)).returning()

		if (result.length === 0) {
			throw APIError.notFound(`User with ID ${userId} not found`)
		}
	},

	/**
	 * Get Full Name
	 * Formats the user's full name with title if available
	 */
	getFullName: (user: User): string => {
		const parts = []

		if (user.title) {
			parts.push(`${user.title}.`)
		}

		parts.push(user.first_name)

		if (user.last_name) {
			parts.push(user.last_name)
		}

		return parts.join(' ')
	}
}
