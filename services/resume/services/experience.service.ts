import {and, eq} from 'drizzle-orm'
import {APIError} from 'encore.dev/api'
import {db} from '@/services/resume/database'
import type {
	ExperiencePathParams,
	ExperienceResponse,
	ExperienceUpsertRequest,
	ExperienceWithCountry,
	ExperienceWithIdParams,
	ListExperiencesResponse
} from '@/services/resume/interface'
import {experiences, resumeSections, ResumeSectionType} from '@/services/resume/schema'
import {ResumeService} from '@/services/resume/service'

/**
 * Experience Service
 * Handles all CRUD operations for experience entries
 */
export const ExperienceService = {
	/**
	 * List all experiences for a resume
	 */
	listExperiences: async ({resume_id}: ExperiencePathParams): Promise<ListExperiencesResponse> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get all experience sections for this resume
		const sections = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.resume_id, resumeId), eq(resumeSections.type, ResumeSectionType.Experience)))
			.orderBy(resumeSections.index)

		// Fetch all experience data in parallel
		const experienceQueries = await Promise.all(
			sections.map(section => db.select().from(experiences).where(eq(experiences.resume_section_id, section.id)).limit(1))
		)

		// Collect all unique country codes
		const countryCodes: string[] = []
		experienceQueries.forEach(expQuery => {
			if (expQuery.length > 0 && expQuery[0].country_code) {
				countryCodes.push(expQuery[0].country_code)
			}
		})

		// Batch lookup all countries
		const countryMap = await ResumeService.batchLookupCountries(countryCodes)

		// Build experience list with country data
		const validExperiences: ExperienceWithCountry[] = []
		experienceQueries.forEach(expQuery => {
			if (expQuery.length > 0) {
				const exp = expQuery[0]
				const country = exp.country_code ? countryMap.get(exp.country_code) || null : null

				validExperiences.push({
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
				})
			}
		})

		return {experiences: validExperiences}
	},

	/**
	 * Get specific experience by ID
	 */
	getExperienceById: async ({resume_id, id}: ExperienceWithIdParams): Promise<ExperienceResponse> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Experience')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get experience
		const expQuery = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1)

		if (expQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found`)
		}

		const exp = expQuery[0]

		// Verify experience belongs to a section in this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, exp.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Lookup country if present
		let country = null
		if (exp.country_code) {
			try {
				country = await ResumeService.lookupCountry(exp.country_code)
			} catch {
				// Country lookup failed, leave as null
			}
		}

		return {
			experience: {
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
		}
	},

	/**
	 * Create new experience entry
	 */
	createExperience: async ({
		resume_id,
		...data
	}: ExperiencePathParams & ExperienceUpsertRequest): Promise<ExperienceResponse> => {
		const userId = ResumeService.getAuthenticatedUserId()
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Validate date ranges
		ResumeService.validateDateRange(data.started_from_month, data.started_from_year)
		ResumeService.validateDateRange(data.finished_at_month, data.finished_at_year)

		// Validate country code if provided
		let country = null
		if (data.country_code) {
			country = await ResumeService.lookupCountry(data.country_code)
		}

		// Create section
		const sectionId = await ResumeService.createSectionForResume(resumeId, ResumeSectionType.Experience)

		// Create experience
		const [exp] = await db
			.insert(experiences)
			.values({
				user_id: userId,
				resume_section_id: sectionId,
				company_name: data.company_name,
				job_title: data.job_title,
				employment_type: data.employment_type,
				city: data.city || null,
				country_code: data.country_code || null,
				started_from_month: data.started_from_month || null,
				started_from_year: data.started_from_year || null,
				finished_at_month: data.finished_at_month || null,
				finished_at_year: data.finished_at_year || null,
				current: data.current || false,
				description: data.description || null
			})
			.returning()

		return {
			experience: {
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
		}
	},

	/**
	 * Update experience entry
	 */
	updateExperience: async ({
		resume_id,
		id,
		...data
	}: ExperienceWithIdParams & ExperienceUpsertRequest): Promise<ExperienceResponse> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Experience')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Verify experience exists and belongs to this resume
		const expQuery = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1)

		if (expQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found`)
		}

		const existingExp = expQuery[0]

		// Verify section belongs to this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, existingExp.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Validate date ranges if provided
		if (data.started_from_month !== undefined || data.started_from_year !== undefined) {
			ResumeService.validateDateRange(
				data.started_from_month ?? existingExp.started_from_month,
				data.started_from_year ?? existingExp.started_from_year
			)
		}
		if (data.finished_at_month !== undefined || data.finished_at_year !== undefined) {
			ResumeService.validateDateRange(
				data.finished_at_month ?? existingExp.finished_at_month,
				data.finished_at_year ?? existingExp.finished_at_year
			)
		}

		// Validate country code if changed
		let country = null
		const countryCode = data.country_code ?? existingExp.country_code
		if (countryCode) {
			country = await ResumeService.lookupCountry(countryCode)
		}

		// Update experience (partial update)
		const updateData: any = {}
		if (data.company_name !== undefined) updateData.company_name = data.company_name
		if (data.job_title !== undefined) updateData.job_title = data.job_title
		if (data.employment_type !== undefined) updateData.employment_type = data.employment_type
		if (data.city !== undefined) updateData.city = data.city
		if (data.country_code !== undefined) updateData.country_code = data.country_code
		if (data.started_from_month !== undefined) updateData.started_from_month = data.started_from_month
		if (data.started_from_year !== undefined) updateData.started_from_year = data.started_from_year
		if (data.finished_at_month !== undefined) updateData.finished_at_month = data.finished_at_month
		if (data.finished_at_year !== undefined) updateData.finished_at_year = data.finished_at_year
		if (data.current !== undefined) updateData.current = data.current
		if (data.description !== undefined) updateData.description = data.description

		const [updatedExp] = await db.update(experiences).set(updateData).where(eq(experiences.id, id)).returning()

		return {
			experience: {
				id: updatedExp.id,
				company_name: updatedExp.company_name,
				job_title: updatedExp.job_title,
				employment_type: updatedExp.employment_type,
				city: updatedExp.city,
				country,
				started_from_month: updatedExp.started_from_month,
				started_from_year: updatedExp.started_from_year,
				finished_at_month: updatedExp.finished_at_month,
				finished_at_year: updatedExp.finished_at_year,
				current: updatedExp.current,
				description: updatedExp.description
			}
		}
	},

	/**
	 * Delete experience entry
	 * Also deletes associated ResumeSection (cascade)
	 */
	deleteExperience: async ({resume_id, id}: ExperienceWithIdParams): Promise<void> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Experience')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get experience
		const expQuery = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1)

		if (expQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found`)
		}

		const exp = expQuery[0]

		// Verify section belongs to this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, exp.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Experience with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Delete section (cascades to experience via FK)
		await db.delete(resumeSections).where(eq(resumeSections.id, exp.resume_section_id))
	}
}

