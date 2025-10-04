import {and, eq} from 'drizzle-orm'
import {APIError} from 'encore.dev/api'
import {db} from '@/services/resume/database'
import type {
	EducationCreateRequest,
	EducationPathParams,
	EducationResponse,
	EducationUpdateRequest,
	EducationWithIdParams
} from '@/services/resume/interface'
import {educations, resumeSections, ResumeSectionType} from '@/services/resume/schema'
import {ResumeService} from '@/services/resume/service'
import log from 'encore.dev/log'

/**
 * Education Service
 * Handles all CRUD operations for education entries
 */
export const EducationService = {
	/**
	 * List all educations for a resume
	 */
	listEducations: async ({resume_id}: EducationPathParams): Promise<{educations: EducationResponse[]}> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get all education sections for this resume
		const sections = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.resume_id, resumeId), eq(resumeSections.type, ResumeSectionType.Education)))
			.orderBy(resumeSections.index)

		// Fetch all education data in parallel
		const educationQueries = await Promise.all(
			sections.map(section => db.select().from(educations).where(eq(educations.resume_section_id, section.id)).limit(1))
		)

		// Collect all unique country codes
		const countryCodes: string[] = []
		educationQueries.forEach(eduQuery => {
			if (eduQuery.length > 0 && eduQuery[0].country_code) {
				countryCodes.push(eduQuery[0].country_code)
			}
		})

		// Batch lookup all countries
		const countryMap = await ResumeService.batchLookupCountries(countryCodes)

		// Build education list with country data
		const validEducations: EducationResponse[] = []
		educationQueries.forEach(eduQuery => {
			if (eduQuery.length > 0) {
				const edu = eduQuery[0]
				const country = edu.country_code ? countryMap.get(edu.country_code) || null : null

				validEducations.push({
					...edu,
					country,
					user: edu.user_id,
					resume_section: edu.resume_section_id
				})
			}
		})

		return {educations: validEducations}
	},

	/**
	 * Get specific education by ID
	 */
	getEducationById: async ({resume_id, id}: EducationWithIdParams): Promise<EducationResponse> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Education')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get education
		const eduQuery = await db.select().from(educations).where(eq(educations.id, id)).limit(1)

		if (eduQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found`)
		}

		const edu = eduQuery[0]

		// Verify education belongs to a section in this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, edu.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Lookup country if present
		let country = null
		if (edu.country_code) {
			try {
				country = await ResumeService.lookupCountry(edu.country_code)
			} catch {
				// Country lookup failed, leave as null
			}
		}

		return {
			...edu,
			country,
			user: edu.user_id,
			resume_section: edu.resume_section_id
		}
	},

	/**
	 * Create new education entry
	 */
	createEducation: async ({resume_id, ...data}: EducationPathParams & EducationCreateRequest): Promise<EducationResponse> => {
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
		const sectionId = await ResumeService.createSectionForResume(resumeId, ResumeSectionType.Education)

		log.info('Education section created in DB')

		// Create education
		const [edu] = await db
			.insert(educations)
			.values({
				user_id: userId,
				resume_section_id: sectionId,
				institution_name: data.institution_name,
				field_of_study: data.field_of_study,
				degree: data.degree || null,
				country_code: data.country_code || null,
				started_from_month: data.started_from_month || null,
				started_from_year: data.started_from_year || null,
				finished_at_month: data.finished_at_month || null,
				finished_at_year: data.finished_at_year || null,
				current: data.current || false,
				description: data.description || null
			})
			.returning()

		// Publish event for thumbnail generation
		await ResumeService.publishResumeUpdate({
			resumeId,
			changeType: 'section_added',
			sectionType: 'Education',
			sectionId: edu.id
		})

		return {
			...edu,
			country,
			user: edu.user_id,
			resume_section: edu.resume_section_id
		}
	},

	/**
	 * Update education entry
	 */
	updateEducation: async ({resume_id, id, ...data}: EducationWithIdParams & EducationUpdateRequest): Promise<EducationResponse> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Education')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Verify education exists and belongs to this resume
		const eduQuery = await db.select().from(educations).where(eq(educations.id, id)).limit(1)

		if (eduQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found`)
		}

		const existingEdu = eduQuery[0]

		// Verify section belongs to this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, existingEdu.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Validate date ranges if provided
		if (data.started_from_month !== undefined || data.started_from_year !== undefined) {
			ResumeService.validateDateRange(
				data.started_from_month ?? existingEdu.started_from_month,
				data.started_from_year ?? existingEdu.started_from_year
			)
		}
		if (data.finished_at_month !== undefined || data.finished_at_year !== undefined) {
			ResumeService.validateDateRange(
				data.finished_at_month ?? existingEdu.finished_at_month,
				data.finished_at_year ?? existingEdu.finished_at_year
			)
		}

		// Validate country code if changed
		let country = null
		const countryCode = data.country_code ?? existingEdu.country_code
		if (countryCode) {
			country = await ResumeService.lookupCountry(countryCode)
		}

		// Update education (partial update)
		const updateData: any = {}
		if (data.institution_name !== undefined) updateData.institution_name = data.institution_name
		if (data.field_of_study !== undefined) updateData.field_of_study = data.field_of_study
		if (data.degree !== undefined) updateData.degree = data.degree
		if (data.country_code !== undefined) updateData.country_code = data.country_code
		if (data.started_from_month !== undefined) updateData.started_from_month = data.started_from_month
		if (data.started_from_year !== undefined) updateData.started_from_year = data.started_from_year
		if (data.finished_at_month !== undefined) updateData.finished_at_month = data.finished_at_month
		if (data.finished_at_year !== undefined) updateData.finished_at_year = data.finished_at_year
		if (data.current !== undefined) updateData.current = data.current
		if (data.description !== undefined) updateData.description = data.description

		const [updatedEdu] = await db.update(educations).set(updateData).where(eq(educations.id, id)).returning()

		// Track which major fields changed
		const changedFields = Object.keys(updateData).filter(field => ['institution_name', 'field_of_study', 'degree', 'country_code'].includes(field))

		// Publish event for thumbnail generation
		if (changedFields.length > 0 || Object.keys(updateData).length > 0) {
			await ResumeService.publishResumeUpdate({
				resumeId,
				changeType: 'section_updated',
				sectionType: 'Education',
				sectionId: id,
				changedFields
			})
		}

		return {
			...updatedEdu,
			country,
			user: updatedEdu.user_id,
			resume_section: updatedEdu.resume_section_id
		}
	},

	/**
	 * Delete education entry
	 * Also deletes associated ResumeSection (cascade)
	 */
	deleteEducation: async ({resume_id, id}: EducationWithIdParams): Promise<void> => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Education')

		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get education
		const eduQuery = await db.select().from(educations).where(eq(educations.id, id)).limit(1)

		if (eduQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found`)
		}

		const edu = eduQuery[0]

		// Verify section belongs to this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, edu.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Education with ID '${id}' not found in resume '${resumeId}'`)
		}

		// Delete section (cascades to education via FK)
		await db.delete(resumeSections).where(eq(resumeSections.id, edu.resume_section_id))

		// Publish event for thumbnail generation
		await ResumeService.publishResumeUpdate({
			resumeId,
			changeType: 'section_removed',
			sectionType: 'Education',
			sectionId: id
		})
	}
}

