import {api, APIError} from 'encore.dev/api'
import {getAuthData} from '~encore/auth'
import type {AuthData} from '@/services/identity/auth'
import type {UpdateProfileRequest, User} from '@/services/identity/interface'
import {IdentityService} from '@/services/identity/service'

/**
 * User Response
 */
interface UserResponse extends User {}

/**
 * Get Current User
 * Returns the currently authenticated user's information
 */
export const getCurrentUser = api(
	{expose: true, method: 'GET', path: '/identity/me', auth: true},
	async (): Promise<UserResponse> => {
		const authData = getAuthData() as AuthData

		return {...authData.user}
	}
)

/**
 * Update Current User Profile
 * Allows authenticated users to update their own profile information
 */
export const updateCurrentUser = api(
	{expose: true, method: 'PUT', path: '/identity/me', auth: true},
	async (data: UpdateProfileRequest): Promise<UserResponse> => {
		const authData = getAuthData() as AuthData
		const userId = authData.user.id

		// Update the user profile
		const updatedUser = await IdentityService.updateUser(userId, data)

		return updatedUser
	}
)

interface UserByEmailParams {
	email: string
}

/**
 * Get User by email
 * Returns the information of the user identified by their email
 */
export const getUserByEmail = api(
	{expose: true, method: 'GET', path: '/identity/email/:email', auth: true},
	async ({email}: UserByEmailParams): Promise<UserResponse> => {
		const user = await IdentityService.getUserByEmail(email)

		if (!user) {
			throw APIError.notFound(`User with email ${email} not found`)
		}

		return user
	}
)
