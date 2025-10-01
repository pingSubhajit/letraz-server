import {api, APIError} from 'encore.dev/api'
import {getAuthData} from '~encore/auth'
import type {AuthData} from '@/services/identity/auth'
import type {User} from '@/services/identity/interface'
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
