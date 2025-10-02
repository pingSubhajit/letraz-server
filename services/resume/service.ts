import {APIError} from 'encore.dev/api'
import {getAuthData} from '~encore/auth'
import {db} from '@/services/resume/database'
import {
	certifications,
	educations,
	experiences,
	proficiencies,
	projects,
	resumes,
	resumeSections,
	ResumeSectionType
} from '@/services/resume/schema'
import {
	DeleteResumeParams,
	GetResumeParams,
	ListResumesParams,
	ListResumesResponse,
	ResumeSectionWithData,
	ResumeWithSections
} from '@/services/resume/interface'
import type {Country} from '@/services/core/interface'
import {AuthData} from '@/services/identity/auth'
import {IdentityService} from '@/services/identity/service'
import {and, count, desc, eq, max} from 'drizzle-orm'
import {core, job} from '~encore/clients'

/**
 * Resume Service
 * Business logic layer for resume operations
 */
export const ResumeService = {
	/**
	 * Get authenticated user ID from auth data
	 */
	getAuthenticatedUserId: (): string => {
		const authData = getAuthData() as AuthData
		return authData.userId
	},

	/**
	 * Resolve resume ID ('base' alias or actual ID)
	 * Returns the resume ID for the authenticated user
	 */
	async resolveResumeId(idOrBase: string): Promise<string> {
		const userId = this.getAuthenticatedUserId()

		if (idOrBase === 'base') {
			// Get or create base resume for user
			const baseResumeQuery = await db
				.select()
				.from(resumes)
				.where(and(eq(resumes.user_id, userId), eq(resumes.base, true)))
				.limit(1)

			if (baseResumeQuery.length === 0) {
				throw APIError.notFound('Base resume not found for user')
			}

			return baseResumeQuery[0].id
		}

		return idOrBase
	},

	/**
	 * Verify resume ownership
	 * Throws PermissionDenied if user doesn't own the resume
	 */
	async verifyResumeOwnership(resumeId: string): Promise<void> {
		const userId = this.getAuthenticatedUserId()

		const resume = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)

		if (resume.length === 0) {
			throw APIError.notFound(`Resume with ID '${resumeId}' not found`)
		}

		if (resume[0].user_id !== userId) {
			throw APIError.permissionDenied('You do not have permission to access this resume')
		}
	},

	/**
	 * List all resumes for authenticated user
	 */
	async listResumes({page_size = 50, page, status, base}: ListResumesParams = {}): Promise<ListResumesResponse> {
		const userId = this.getAuthenticatedUserId()
		const limit = Math.min(Math.max(page_size, 1), 200)
		const offset = ((page || 1) - 1) * page_size

		// Build query filters
		const filters = [eq(resumes.user_id, userId)]
		if (status) {
			filters.push(eq(resumes.status, status))
		}
		if (base !== undefined) {
			filters.push(eq(resumes.base, base))
		}

		// Fetch resumes
		const resumesData = await db
			.select()
			.from(resumes)
			.where(and(...filters))
			.orderBy(desc(resumes.created_at))
			.limit(limit)
			.offset(offset)

		// Enrich with user and job data
		const enrichedResumes = await Promise.all(
			resumesData.map(async resume => {
				const user = await this.fetchUserData(resume.user_id)
				let jobData = null
				if (resume.job_id) {
					jobData = await this.fetchJobData(resume.job_id)
				}

				return {
					id: resume.id,
					base: resume.base,
					user,
					job: jobData,
					status: resume.status,
					thumbnail: resume.thumbnail,
					created_at: resume.created_at,
					updated_at: resume.updated_at
				}
			})
		)

		// Get total count
		const totalQuery = await db
			.select({count: count()})
			.from(resumes)
			.where(and(...filters))

		const total = totalQuery[0].count

		const has_next = offset + page_size < total
		const has_prev = !!offset

		return {
			data: enrichedResumes,
			page: page || 1,
			page_size: limit,
			total,
			has_next,
			has_prev
		}
	},

	/**
	 * Get resume by ID with all sections and nested data
	 */
	async getResumeById({id}: GetResumeParams): Promise<ResumeWithSections> {
		const resumeId = await this.resolveResumeId(id)
		await this.verifyResumeOwnership(resumeId)

		// Fetch resume
		const resumeQuery = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)

		if (resumeQuery.length === 0) {
			throw APIError.notFound(`Resume with ID '${resumeId}' not found`)
		}

		const resume = resumeQuery[0]

		// Fetch user data
		const user = await this.fetchUserData(resume.user_id)

		// Fetch job data if job_id exists
		let jobData = null
		if (resume.job_id) {
			jobData = await this.fetchJobData(resume.job_id)
		}

		// Fetch all sections with relations
		const sections = await db
			.select()
			.from(resumeSections)
			.where(eq(resumeSections.resume_id, resumeId))
			.orderBy(resumeSections.index)

		// Collect all section data first
		const sectionDataPromises = sections.map(async section => {
			switch (section.type) {
				case 'Education':
					return db.select().from(educations).where(eq(educations.resume_section_id, section.id)).limit(1)
				case 'Experience':
					return db.select().from(experiences).where(eq(experiences.resume_section_id, section.id)).limit(1)
				case 'Project':
					return db.select().from(projects).where(eq(projects.resume_section_id, section.id)).limit(1)
				case 'Certification':
					return db.select().from(certifications).where(eq(certifications.resume_section_id, section.id)).limit(1)
				case 'Skill':
					return db.select().from(proficiencies).where(eq(proficiencies.resume_section_id, section.id))
				default:
					return []
			}
		})

		const allSectionData = await Promise.all(sectionDataPromises)

		// Collect all unique country codes
		const countryCodes: string[] = []
		allSectionData.forEach((data, idx) => {
			if (data.length > 0) {
				const item = data[0]
				if ('country_code' in item && item.country_code) {
					countryCodes.push(item.country_code as string)
				}
			}
		})

		// Batch lookup all countries
		const countryMap = await this.batchLookupCountries(countryCodes)

		// Build sections with nested data
		const sectionsWithData = sections.map((section, idx) => {
			let data = null
			const sectionData = allSectionData[idx]

			if (sectionData.length > 0) {
				switch (section.type) {
					case 'Education': {
						const edu = sectionData[0] as any
						const country = edu.country_code ? countryMap.get(edu.country_code) || null : null
						data = {
							id: edu.id,
							institution_name: edu.institution_name,
							field_of_study: edu.field_of_study,
							degree: edu.degree,
							country,
							started_from_month: edu.started_from_month,
							started_from_year: edu.started_from_year,
							finished_at_month: edu.finished_at_month,
							finished_at_year: edu.finished_at_year,
							current: edu.current,
							description: edu.description
						}
						break
					}
					case 'Experience': {
						const exp = sectionData[0] as any
						const country = exp.country_code ? countryMap.get(exp.country_code) || null : null
						data = {
							id: exp.id,
							company_name: exp.company_name,
							job_title: exp.job_title,
							employment_type: exp.employment_type,
							city: exp.city,
							country,
							started_from_month: exp.started_from_month,
							started_from_year: exp.started_from_year,
							finished_at_month: exp.finished_at_month,
							finished_at_year: exp.finished_at_year,
							current: exp.current,
							description: exp.description
						}
						break
					}
					case 'Project': {
						const project = sectionData[0] as any
						// TODO: Fetch skills_used in Part 4
						data = {...project, skills_used: []}
						break
					}
					case 'Certification': {
						data = sectionData[0]
						break
					}
					case 'Skill': {
						// TODO: Join with skills table in Part 4
						data = {skills: sectionData}
						break
					}
				}
			}

			return {
				id: section.id,
				resume_id: section.resume_id,
				index: section.index,
				type: section.type,
				data
			}
		})

		return {
			id: resume.id,
			base: resume.base,
			user,
			job: jobData,
			status: resume.status,
			thumbnail: resume.thumbnail,
			// TODO: Remove type assertion after Part 4 (clean up Projects, Certifications, Skills data)
			sections: sectionsWithData as ResumeSectionWithData[],
			created_at: resume.created_at,
			updated_at: resume.updated_at
		}
	},

	/**
	 * Delete resume by ID
	 * Cannot delete base resume
	 */
	async deleteResume({id}: DeleteResumeParams): Promise<void> {
		const resumeId = await this.resolveResumeId(id)
		await this.verifyResumeOwnership(resumeId)

		// Prevent deletion of base resume
		if (id === 'base') {
			throw APIError.invalidArgument('Cannot delete base resume')
		}

		// Check if it's a base resume by ID
		const resumeQuery = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)

		if (resumeQuery.length === 0) {
			throw APIError.notFound(`Resume with ID '${resumeId}' not found`)
		}

		if (resumeQuery[0].base) {
			throw APIError.invalidArgument('Cannot delete base resume')
		}

		// Delete resume (cascades to sections and all nested data)
		await db.delete(resumes).where(eq(resumes.id, resumeId))
	},

	/**
	 * ==========================================
	 * SHARED UTILITIES
	 * ==========================================
	 */

	/**
	 * Create a new section for a resume with auto-incremented index
	 */
	createSectionForResume: async (resumeId: string, type: ResumeSectionType): Promise<string> => {
		// Get the max index for this resume
		const maxIndexQuery = await db
			.select({maxIndex: max(resumeSections.index)})
			.from(resumeSections)
			.where(eq(resumeSections.resume_id, resumeId))

		const nextIndex = (maxIndexQuery[0].maxIndex ?? -1) + 1

		// Create new section
		const [section] = await db
			.insert(resumeSections)
			.values({
				resume_id: resumeId,
				index: nextIndex,
				type
			})
			.returning()

		return section.id
	},

	/**
	 * Validate UUID format
	 */
	validateUUID: (id: string, fieldName: string = 'ID'): void => {
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		if (!uuidRegex.test(id)) {
			throw APIError.notFound(`${fieldName} '${id}' not found`)
		}
	},

	/**
	 * Validate date range values
	 */
	validateDateRange: (month?: number | null, year?: number | null): void => {
		if (month !== null && month !== undefined) {
			if (month < 1 || month > 12) {
				throw APIError.invalidArgument('Month must be between 1 and 12')
			}
		}
		if (year !== null && year !== undefined) {
			if (year < 1900 || year > 2100) {
				throw APIError.invalidArgument('Year must be between 1900 and 2100')
			}
		}
	},

	/**
	 * Lookup country via core service
	 * Returns country data or throws error if not found
	 */
	lookupCountry: async (code: string) => {
		try {
			const country = await core.getCountry({code})
			return country
		} catch (err) {
			throw APIError.invalidArgument(`Invalid country code: ${code}`)
		}
	},

	/**
	 * Batch lookup countries
	 * Fetches multiple countries in parallel and returns a map
	 */
	batchLookupCountries: async (codes: string[]): Promise<Map<string, Country>> => {
		const uniqueCodes = Array.from(new Set(codes.filter(code => code)))
		const countryMap = new Map<string, Country>()

		await Promise.all(
			uniqueCodes.map(async code => {
				try {
					const country = await core.getCountry({code})
					countryMap.set(code, country)
				} catch {
					// Country lookup failed, don't add to map
				}
			})
		)

		return countryMap
	},

	/**
	 * Fetch user data from identity service
	 */
	fetchUserData: async (userId: string) => {
		const user = await IdentityService.getUserById(userId)
		if (!user) {
			throw APIError.internal(`User ${userId} not found`)
		}
		return user
	},

	/**
	 * Fetch job data from job service
	 */
	fetchJobData: async (jobId: string) => {
		try {
			const jobData = await job.getJob({id: jobId})
			return jobData.job
		} catch (err) {
			// Job not found or error, return null
			return null
		}
	}

}

