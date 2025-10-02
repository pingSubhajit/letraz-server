import {APIError} from 'encore.dev/api'
import {getAuthData} from '~encore/auth'
import {db} from '@/services/resume/database'
import {
	certifications,
	educations,
	experiences,
	ProcessStatus,
	proficiencies,
	projects,
	projectSkills,
	resumeProcesses,
	resumes,
	resumeSections,
	ResumeSectionType,
	ResumeStatus,
	skills
} from '@/services/resume/schema'
import {
	DeleteResumeParams,
	GetResumeParams,
	ListResumesParams,
	ListResumesResponse,
	RearrangeSectionsRequest,
	ResumeWithSections,
	TailorResumeRequest,
	TailorResumeResponse
} from '@/services/resume/interface'
import type {Country} from '@/services/core/interface'
import {AuthData} from '@/services/identity/auth'
import {IdentityService} from '@/services/identity/service'
import {and, count, desc, eq, inArray, max} from 'drizzle-orm'
import {core, job} from '~encore/clients'
import {resumeTailoringTriggered} from '@/services/resume/topics'
import {JobStatus} from '@/services/job/schema'
import log from 'encore.dev/log'

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
	 * Skips ownership check for admin users
	 */
	verifyResumeOwnership: async (resumeId: string): Promise<void> => {
		const authData = getAuthData() as AuthData
		const userId = authData.userId

		// Skip ownership check for admin users
		if (userId === 'admin') {
			// Verify resume exists
			const resume = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)
			if (resume.length === 0) {
				throw APIError.notFound(`Resume with ID '${resumeId}' not found`)
			}
			return
		}

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
		allSectionData.forEach((data) => {
			if (data.length > 0) {
				const item = data[0]
				if ('country_code' in item && item.country_code) {
					countryCodes.push(item.country_code as string)
				}
			}
		})

		// Batch lookup all countries
		const countryMap = await this.batchLookupCountries(countryCodes)

		// Collect all skill IDs and project IDs for batch fetching
		const allSkillIds: string[] = []
		const projectIds: string[] = []

		allSectionData.forEach((data, idx) => {
			const section = sections[idx]
			if (data.length > 0) {
				if (section.type === 'Skill') {
					// Collect skill IDs from proficiencies
					data.forEach((prof: any) => {
						if (prof.skill_id) allSkillIds.push(prof.skill_id)
					})
				} else if (section.type === 'Project') {
					// Collect project ID for skills_used lookup
					const project = data[0] as any
					if (project.id) projectIds.push(project.id)
				}
			}
		})

		// Batch fetch all skills
		const allSkillsData = allSkillIds.length > 0
			? await db.select().from(skills).where(inArray(skills.id, allSkillIds))
			: []
		const skillMap = new Map(allSkillsData.map(s => [s.id, s]))

		// Batch fetch project skills
		const allProjectSkills = projectIds.length > 0
			? await db.select().from(projectSkills).where(inArray(projectSkills.project_id, projectIds))
			: []
		// Group by project_id
		const projectSkillsMap = new Map<string, string[]>()
		allProjectSkills.forEach(ps => {
			if (!projectSkillsMap.has(ps.project_id)) {
				projectSkillsMap.set(ps.project_id, [])
			}
			projectSkillsMap.get(ps.project_id)!.push(ps.skill_id)
		})

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

						// Get skills for this project from pre-fetched data
						const projectSkillIds = projectSkillsMap.get(project.id) || []
						const projectSkillsData = projectSkillIds
							.map(skillId => skillMap.get(skillId))
							.filter((skill): skill is typeof skills.$inferSelect => skill !== undefined)

						data = {
							id: project.id,
							name: project.name,
							category: project.category,
							description: project.description,
							role: project.role,
							github_url: project.github_url,
							live_url: project.live_url,
							started_from_month: project.started_from_month,
							started_from_year: project.started_from_year,
							finished_at_month: project.finished_at_month,
							finished_at_year: project.finished_at_year,
							current: project.current,
							skills_used: projectSkillsData
						}
						break
					}
					case 'Certification': {
						const cert = sectionData[0] as any
						data = {
							id: cert.id,
							name: cert.name,
							issuing_organization: cert.issuing_organization,
							issue_date: cert.issue_date,
							credential_url: cert.credential_url
						}
						break
					}
					case 'Skill': {
					// Build ProficiencyWithSkill array from pre-fetched data
						const proficiencyRecords = sectionData as any[]
						const proficienciesWithSkills = proficiencyRecords.map(prof => {
							const skill = skillMap.get(prof.skill_id)
							if (!skill) {
								throw APIError.internal(`Skill not found for proficiency ${prof.id}`)
							}
							return {
								id: prof.id,
								skill: {
									id: skill.id,
									name: skill.name,
									category: skill.category,
									preferred: skill.preferred,
									created_at: skill.created_at,
									updated_at: skill.updated_at
								},
								level: prof.level
							}
						})

						data = {skills: proficienciesWithSkills}
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
			sections: sectionsWithData,
			created_at: resume.created_at,
			updated_at: resume.updated_at
		}
	},

	/**
	 * Internal version of getResumeById that skips auth checks
	 * Used by event handlers and internal services where access is already validated
	 */
	async getResumeByIdInternal(resumeId: string): Promise<ResumeWithSections> {
		// Fetch resume (skip ownership verification)
		const resumeQuery = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)

		if (resumeQuery.length === 0) {
			throw APIError.notFound(`Resume with ID '${resumeId}' not found`)
		}

		const resume = resumeQuery[0]

		// Fetch user data
		const user = await this.fetchUserData(resume.user_id)

		// Fetch job data if linked
		const jobData = resume.job_id ? await this.fetchJobData(resume.job_id) : null

		// Fetch all sections
		const sections = await db
			.select()
			.from(resumeSections)
			.where(eq(resumeSections.resume_id, resumeId))
			.orderBy(resumeSections.index)

		// Collect all skill IDs and country codes for batch fetching
		const skillIds = new Set<string>()
		const countryCodes = new Set<string>()

		for (const section of sections) {
			if (section.type === 'Skill') {
				const proficiencyData = await db
					.select()
					.from(proficiencies)
					.where(eq(proficiencies.resume_section_id, section.id))
				proficiencyData.forEach(p => skillIds.add(p.skill_id))
			} else if (section.type === 'Project') {
				const projectData = await db.select().from(projects).where(eq(projects.resume_section_id, section.id))
				for (const proj of projectData) {
					const projSkills = await db
						.select({skill_id: projectSkills.skill_id})
						.from(projectSkills)
						.where(eq(projectSkills.project_id, proj.id))
					projSkills.forEach(ps => skillIds.add(ps.skill_id))
				}
			} else if (section.type === 'Education') {
				const eduData = await db.select().from(educations).where(eq(educations.resume_section_id, section.id))
				eduData.forEach(e => {
					if (e.country_code) countryCodes.add(e.country_code)
				})
			} else if (section.type === 'Experience') {
				const expData = await db.select().from(experiences).where(eq(experiences.resume_section_id, section.id))
				expData.forEach(e => {
					if (e.country_code) countryCodes.add(e.country_code)
				})
			}
		}

		// Batch fetch all skills
		const skillMap = new Map<string, any>()
		if (skillIds.size > 0) {
			const skillsData = await db
				.select()
				.from(skills)
				.where(inArray(skills.id, Array.from(skillIds)))
			skillsData.forEach(s => skillMap.set(s.id, s))
		}

		// Batch fetch all countries
		const countryMap = await this.batchLookupCountries(Array.from(countryCodes))

		// Build sections with data
		const sectionsWithData = await Promise.all(
			sections.map(async section => {
				let data: any

				switch (section.type) {
					case 'Education': {
						const eduQuery = await db
							.select()
							.from(educations)
							.where(eq(educations.resume_section_id, section.id))
							.limit(1)

						if (eduQuery.length > 0) {
							const edu = eduQuery[0]
							const country = edu.country_code ? countryMap.get(edu.country_code) || null : null

							data = {
								education: {
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
							}
						}
						break
					}

					case 'Experience': {
						const expQuery = await db
							.select()
							.from(experiences)
							.where(eq(experiences.resume_section_id, section.id))
							.limit(1)

						if (expQuery.length > 0) {
							const exp = expQuery[0]
							const country = exp.country_code ? countryMap.get(exp.country_code) || null : null

							data = {
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
						}
						break
					}

					case 'Skill': {
						const proficiencyRecords = await db
							.select()
							.from(proficiencies)
							.where(eq(proficiencies.resume_section_id, section.id))

						const proficienciesWithSkills = proficiencyRecords.map(prof => {
							const skill = skillMap.get(prof.skill_id)
							if (!skill) {
								throw APIError.internal(`Skill not found for proficiency ${prof.id}`)
							}
							return {
								id: prof.id,
								skill: {
									id: skill.id,
									name: skill.name,
									category: skill.category,
									preferred: skill.preferred,
									created_at: skill.created_at,
									updated_at: skill.updated_at
								},
								level: prof.level
							}
						})

						data = {skills: proficienciesWithSkills}
						break
					}

					case 'Project': {
						const projectQuery = await db
							.select()
							.from(projects)
							.where(eq(projects.resume_section_id, section.id))
							.limit(1)

						if (projectQuery.length > 0) {
							const proj = projectQuery[0]
							const projSkillIds = await db
								.select({skill_id: projectSkills.skill_id})
								.from(projectSkills)
								.where(eq(projectSkills.project_id, proj.id))

							const skillsUsed = projSkillIds
								.map(ps => skillMap.get(ps.skill_id))
								.filter(s => s != null)
								.map(s => ({
									id: s.id,
									name: s.name,
									category: s.category,
									preferred: s.preferred,
									created_at: s.created_at,
									updated_at: s.updated_at
								}))

							data = {
								project: {
									id: proj.id,
									name: proj.name,
									category: proj.category,
									description: proj.description,
									role: proj.role,
									github_url: proj.github_url,
									live_url: proj.live_url,
									started_from_month: proj.started_from_month,
									started_from_year: proj.started_from_year,
									finished_at_month: proj.finished_at_month,
									finished_at_year: proj.finished_at_year,
									current: proj.current,
									skills_used: skillsUsed
								}
							}
						}
						break
					}

					case 'Certification': {
						const certQuery = await db
							.select()
							.from(certifications)
							.where(eq(certifications.resume_section_id, section.id))
							.limit(1)

						if (certQuery.length > 0) {
							const cert = certQuery[0]
							data = {
								certification: {
									id: cert.id,
									name: cert.name,
									issuing_organization: cert.issuing_organization,
									issue_date: cert.issue_date,
									credential_url: cert.credential_url
								}
							}
						}
						break
					}

					default:
						data = {}
				}

				return {
					id: section.id,
					resume_id: section.resume_id,
					index: section.index,
					type: section.type,
					data
				}
			})
		)

		return {
			id: resume.id,
			base: resume.base,
			user,
			job: jobData,
			status: resume.status,
			thumbnail: resume.thumbnail,
			sections: sectionsWithData,
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
			return await core.getCountry({code})
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
	},

	/**
	 * Rearrange resume sections
	 * Uses two-phase update to avoid unique constraint violations
	 */
	rearrangeSections: async ({id, section_ids}: RearrangeSectionsRequest): Promise<ResumeWithSections> => {
		const resumeId = await ResumeService.resolveResumeId(id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Validate section_ids are unique
		const uniqueSectionIds = new Set(section_ids)
		if (uniqueSectionIds.size !== section_ids.length) {
			throw APIError.invalidArgument('Duplicate section IDs provided')
		}

		// Get all existing sections for this resume
		const existingSections = await db
			.select()
			.from(resumeSections)
			.where(eq(resumeSections.resume_id, resumeId))
			.orderBy(resumeSections.index)

		// Validate all section_ids belong to this resume
		const existingSectionIds = new Set(existingSections.map(s => s.id))
		const invalidIds = section_ids.filter(id => !existingSectionIds.has(id))

		if (invalidIds.length > 0) {
			throw APIError.invalidArgument(`Section IDs do not belong to this resume: ${invalidIds.join(', ')}`)
		}

		// Validate all existing sections are included
		if (existingSectionIds.size !== section_ids.length) {
			const missingIds = Array.from(existingSectionIds).filter(id => !uniqueSectionIds.has(id))
			throw APIError.invalidArgument(`Missing section IDs in request: ${missingIds.join(', ')}`)
		}

		/*
		 * Two-phase update to avoid unique constraint violations
		 * Phase 1: Set all to negative indices
		 */
		await db.transaction(async tx => {
			// Phase 1: Set all to negative indices
			for (let i = 0; i < section_ids.length; i++) {
				await tx
					.update(resumeSections)
					.set({index: -(i + 1)})
					.where(eq(resumeSections.id, section_ids[i]))
			}

			// Phase 2: Set final positive indices
			for (let i = 0; i < section_ids.length; i++) {
				await tx
					.update(resumeSections)
					.set({index: i})
					.where(eq(resumeSections.id, section_ids[i]))
			}
		})

		// Return updated resume with sections
		return ResumeService.getResumeById({id: resumeId})
	},

	/**
	 * Tailor resume for a job
	 * Creates or retrieves a job-specific resume and initiates tailoring process
	 *
	 * Retry Logic:
	 * - If job scraping previously failed, retries by calling scrapeJob again
	 * - If resume tailoring previously failed, creates new process and resets status
	 */
	async tailorResume({target}: TailorResumeRequest): Promise<TailorResumeResponse> {
		const userId = this.getAuthenticatedUserId()

		// Validate target
		if (!target || target.trim().length < 10) {
			throw APIError.invalidArgument('Target must be at least 10 characters')
		}

		// Detect if target is a URL
		const isUrl = /^https?:\/\//i.test(target.trim())
		const jobUrl = isUrl ? target.trim() : undefined

		// Call scrapeJob to create/get the job (handles deduplication internally)
		const {job: scrapedJob} = await job.scrapeJob({target})

		// Check if resume already exists for this user + job
		const existingResumeQuery = await db
			.select()
			.from(resumes)
			.where(and(eq(resumes.user_id, userId), eq(resumes.job_id, scrapedJob.id)))
			.limit(1)

		if (existingResumeQuery.length > 0) {
			const existingResume = existingResumeQuery[0]

			// If existing resume failed, retry by resetting it
			if (existingResume.status === ResumeStatus.Failure) {
				log.info('Existing resume failed, retrying tailoring', {
					resume_id: existingResume.id,
					job_id: scrapedJob.id,
					user_id: userId
				})

				// Create a new resume process for the retry
				const [newResumeProcess] = await db
					.insert(resumeProcesses)
					.values({
						desc: 'Retrying resume tailoring for job',
						status: ProcessStatus.Initiated,
						status_details: null
					})
					.returning()

				// Update resume: reset status, detach old process, attach new process
				await db
					.update(resumes)
					.set({
						status: ResumeStatus.Processing,
						process_id: newResumeProcess.id
					})
					.where(eq(resumes.id, existingResume.id))

				log.info('Resume reset for retry', {
					resume_id: existingResume.id,
					old_process_id: existingResume.process_id,
					new_process_id: newResumeProcess.id,
					user_id: userId
				})

				// Conditionally publish event based on job status
				if (scrapedJob.status === JobStatus.Success) {
					try {
						await resumeTailoringTriggered.publish({
							resume_id: existingResume.id,
							job_id: scrapedJob.id,
							process_id: newResumeProcess.id,
							user_id: userId,
							job_url: jobUrl,
							triggered_at: new Date()
						})

						log.info('Resume tailoring triggered event published (retry, job ready)', {
							resume_id: existingResume.id,
							job_id: scrapedJob.id,
							user_id: userId
						})
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : 'Unknown error'
						log.error('Failed to publish resume tailoring triggered event', {
							resume_id: existingResume.id,
							job_id: scrapedJob.id,
							user_id: userId,
							error: errorMessage
						})
					}
				} else {
					log.info('Resume retry initiated, waiting for job scraping', {
						resume_id: existingResume.id,
						job_id: scrapedJob.id,
						job_status: scrapedJob.status,
						user_id: userId
					})
				}

				// Return the updated resume
				const fullResume = await this.getResumeById({id: existingResume.id})
				return {
					resume: fullResume
				}
			}

			// Resume exists and is not failed - return it as-is
			const fullResume = await this.getResumeById({id: existingResume.id})
			return {
				resume: fullResume
			}
		}

		// Create a new resume process for tracking tailoring
		const [resumeProcess] = await db
			.insert(resumeProcesses)
			.values({
				desc: 'Tailoring resume for job',
				status: ProcessStatus.Initiated,
				status_details: null
			})
			.returning()

		// Create a new non-base resume linked to the job
		const [newResume] = await db
			.insert(resumes)
			.values({
				user_id: userId,
				base: false,
				job_id: scrapedJob.id,
				status: ResumeStatus.Processing,
				process_id: resumeProcess.id
			})
			.returning()

		// Only publish tailoring triggered event if job scraping already succeeded
		if (scrapedJob.status === JobStatus.Success) {
			try {
				await resumeTailoringTriggered.publish({
					resume_id: newResume.id,
					job_id: scrapedJob.id,
					process_id: resumeProcess.id,
					user_id: userId,
					job_url: jobUrl,
					triggered_at: new Date()
				})

				log.info('Resume tailoring triggered event published (job ready)', {
					resume_id: newResume.id,
					job_id: scrapedJob.id,
					user_id: userId
				})
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error'
				log.error('Failed to publish resume tailoring triggered event', {
					resume_id: newResume.id,
					job_id: scrapedJob.id,
					user_id: userId,
					error: errorMessage
				})
			}
		} else {
			// Job is still processing - event will be published when job scraping succeeds
			log.info('Resume created, waiting for job scraping to complete', {
				resume_id: newResume.id,
				job_id: scrapedJob.id,
				job_status: scrapedJob.status,
				user_id: userId
			})
		}

		// Get the full resume with sections
		const fullResume = await this.getResumeById({id: newResume.id})

		return {
			resume: fullResume
		}
	}

}
