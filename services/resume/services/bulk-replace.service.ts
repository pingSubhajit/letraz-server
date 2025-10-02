import {APIError} from 'encore.dev/api'
import {db} from '@/services/resume/database'
import type * as schema from '@/services/resume/schema'
import {
	certifications,
	educations,
	experiences,
	proficiencies,
	ProficiencyLevel,
	projects,
	projectSkills,
	resumeSections,
	ResumeSectionType,
	skills
} from '@/services/resume/schema'
import type {
	CertificationUpsertRequest,
	EducationUpsertRequest,
	ExperienceUpsertRequest,
	ProjectUpsertRequest,
	ReplaceResumeRequest,
	ResumeWithSections,
	SectionReplaceInput,
	SkillInput
} from '@/services/resume/interface'
import {ResumeService} from '@/services/resume/service'
import {and, eq, isNull, or} from 'drizzle-orm'
import {core} from '~encore/clients'
import type {NodePgDatabase} from 'drizzle-orm/node-postgres'

/**
 * Type definitions for section data
 */
type TransactionType = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0]

/**
 * Skill Section Data for bulk replace
 * Wraps skills array for section-based operations
 */
interface SkillSectionData {
	skills: Array<{
		name: string
		category?: string | null
		level?: string | null
	}>
}

/**
 * Bulk Replace Service
 * Handles complete resume replacement with atomic transactions
 *
 * Key responsibilities:
 * - Validate entire payload before DB changes
 * - Use transactions for atomicity
 * - Optimize skill resolution (collect all, bulk lookup/create)
 * - Handle section ordering
 * - Return complete resume with all data
 */

/**
 * Type guards and validators
 */
const Validators: {
	validateEducation(data: unknown): asserts data is EducationUpsertRequest
	validateExperience(data: unknown): asserts data is ExperienceUpsertRequest
	validateProject(data: unknown): asserts data is ProjectUpsertRequest
	validateCertification(data: unknown): asserts data is CertificationUpsertRequest
	validateSkill(data: unknown): asserts data is SkillSectionData
} = {
	/**
	 * Validate Education data
	 */
	validateEducation: (data: unknown): asserts data is EducationUpsertRequest => {
		const d = data as Record<string, unknown>
		if (!d.institution_name || typeof d.institution_name !== 'string' || d.institution_name.trim() === '') {
			throw APIError.invalidArgument('Education: institution_name is required')
		}
		if (!d.field_of_study || typeof d.field_of_study !== 'string') {
			throw APIError.invalidArgument('Education: field_of_study is required')
		}
		if (!d.degree || typeof d.degree !== 'string') {
			throw APIError.invalidArgument('Education: degree is required')
		}

		// Validate date ranges if provided
		if (d.started_from_month !== undefined || d.started_from_year !== undefined) {
			ResumeService.validateDateRange(d.started_from_month as number, d.started_from_year as number)
		}
		if (d.finished_at_month !== undefined || d.finished_at_year !== undefined) {
			ResumeService.validateDateRange(d.finished_at_month as number, d.finished_at_year as number)
		}

		// Validate country code if provided
		if (d.country_code && typeof d.country_code !== 'string') {
			throw APIError.invalidArgument('Education: country_code must be a string')
		}
	},

	/**
	 * Validate Experience data
	 */
	validateExperience: (data: unknown): asserts data is ExperienceUpsertRequest => {
		const d = data as Record<string, unknown>
		if (!d.company_name || typeof d.company_name !== 'string' || d.company_name.trim() === '') {
			throw APIError.invalidArgument('Experience: company_name is required')
		}
		if (!d.job_title || typeof d.job_title !== 'string' || d.job_title.trim() === '') {
			throw APIError.invalidArgument('Experience: job_title is required')
		}

		// Validate date ranges if provided
		if (d.started_from_month !== undefined || d.started_from_year !== undefined) {
			ResumeService.validateDateRange(d.started_from_month as number, d.started_from_year as number)
		}
		if (d.finished_at_month !== undefined || d.finished_at_year !== undefined) {
			ResumeService.validateDateRange(d.finished_at_month as number, d.finished_at_year as number)
		}

		// Validate country code if provided
		if (d.country_code && typeof d.country_code !== 'string') {
			throw APIError.invalidArgument('Experience: country_code must be a string')
		}
	},

	/**
	 * Validate Project data
	 */
	validateProject: (data: unknown): asserts data is ProjectUpsertRequest => {
		const d = data as Record<string, unknown>
		if (!d.name || typeof d.name !== 'string' || d.name.trim() === '') {
			throw APIError.invalidArgument('Project: name is required')
		}

		// Validate date ranges if provided
		if (d.started_from_month !== undefined || d.started_from_year !== undefined) {
			ResumeService.validateDateRange(d.started_from_month as number, d.started_from_year as number)
		}
		if (d.finished_at_month !== undefined || d.finished_at_year !== undefined) {
			ResumeService.validateDateRange(d.finished_at_month as number, d.finished_at_year as number)
		}

		// Validate skills_used if provided
		if (d.skills_used && !Array.isArray(d.skills_used)) {
			throw APIError.invalidArgument('Project: skills_used must be an array')
		}
		if (d.skills_used) {
			(d.skills_used as unknown[]).forEach((skill, idx) => {
				const s = skill as Record<string, unknown>
				if (!s.name || typeof s.name !== 'string' || s.name.trim() === '') {
					throw APIError.invalidArgument(`Project: skills_used[${idx}].name is required`)
				}
			})
		}
	},

	/**
	 * Validate Certification data
	 */
	validateCertification: (data: unknown): asserts data is CertificationUpsertRequest => {
		const d = data as Record<string, unknown>
		if (!d.name || typeof d.name !== 'string' || d.name.trim() === '') {
			throw APIError.invalidArgument('Certification: name is required')
		}

		// Validate and parse issue_date if provided
		if (d.issue_date !== undefined && d.issue_date !== null) {
			if (typeof d.issue_date === 'string') {
				const parsed = new Date(d.issue_date)
				if (isNaN(parsed.getTime())) {
					throw APIError.invalidArgument('Certification: issue_date must be a valid date string')
				}
				// Replace string with Date object
				d.issue_date = parsed
			} else if (!(d.issue_date instanceof Date)) {
				throw APIError.invalidArgument('Certification: issue_date must be a date string or Date object')
			}
		}
	},

	/**
	 * Validate Skill data
	 */
	validateSkill: (data: unknown): asserts data is SkillSectionData => {
		const d = data as Record<string, unknown>
		if (!d.skills || !Array.isArray(d.skills)) {
			throw APIError.invalidArgument('Skill: skills array is required')
		}
		(d.skills as unknown[]).forEach((skill, idx) => {
			const s = skill as Record<string, unknown>
			if (!s.name || typeof s.name !== 'string' || s.name.trim() === '') {
				throw APIError.invalidArgument(`Skill: skills[${idx}].name is required`)
			}
			// Validate proficiency level if provided
			if (s.level !== undefined && s.level !== null) {
				const validLevels = Object.values(ProficiencyLevel)
				if (!validLevels.includes(s.level as ProficiencyLevel)) {
					throw APIError.invalidArgument(
						`Skill: skills[${idx}].level must be one of: ${validLevels.join(', ')}`
					)
				}
			}
		})
	}
}

/**
 * Skill resolution helpers
 */
const SkillHelpers = {
	/**
	 * Collect all unique skills from sections
	 * Returns array of {name, category} objects
	 */
	collectAllSkills: (sections: SectionReplaceInput[]): Array<{name: string; category: string | null}> => {
		const skillsMap = new Map<string, {name: string; category: string | null}>()

		sections.forEach(section => {
			if (section.type === ResumeSectionType.Skill) {
				// Skill section
				const skillData = section.data as any
				if (skillData.skills && Array.isArray(skillData.skills)) {
					skillData.skills.forEach((skill: any) => {
						const name = skill.name.trim()
						const category = skill.category?.trim() || null
						const key = `${category}:${name}`
						if (!skillsMap.has(key)) {
							skillsMap.set(key, {name, category})
						}
					})
				}
			} else if (section.type === ResumeSectionType.Project) {
				// Project skills_used
				const projectData = section.data as any
				if (projectData.skills_used && Array.isArray(projectData.skills_used)) {
					projectData.skills_used.forEach((skill: SkillInput) => {
						const name = skill.name.trim()
						const category = skill.category?.trim() || null
						const key = `${category}:${name}`
						if (!skillsMap.has(key)) {
							skillsMap.set(key, {name, category})
						}
					})
				}
			}
		})

		return Array.from(skillsMap.values())
	},

	/**
	 * Bulk lookup/create skills
	 * Returns Map<"category:name", skillId>
	 */
	bulkResolveSkills: async (
		skillInputs: Array<{name: string; category: string | null}>
	): Promise<Map<string, string>> => {
		if (skillInputs.length === 0) {
			return new Map()
		}

		const skillIdMap = new Map<string, string>()

		// Build OR conditions for bulk lookup
		const orConditions = skillInputs.map(({name, category}) => and(eq(skills.name, name), category ? eq(skills.category, category) : isNull(skills.category)))

		// Lookup existing skills
		const existingSkills = await db
			.select()
			.from(skills)
			.where(or(...orConditions))

		// Map existing skills
		existingSkills.forEach(skill => {
			const key = `${skill.category}:${skill.name}`
			skillIdMap.set(key, skill.id)
		})

		// Find skills that need to be created
		const skillsToCreate = skillInputs.filter(({name, category}) => {
			const key = `${category}:${name}`
			return !skillIdMap.has(key)
		})

		// Bulk insert new skills
		if (skillsToCreate.length > 0) {
			const newSkills = await db
				.insert(skills)
				.values(
					skillsToCreate.map(({name, category}) => ({
						name,
						category,
						preferred: false
					}))
				)
				.returning()

			// Map newly created skills
			newSkills.forEach(skill => {
				const key = `${skill.category}:${skill.name}`
				skillIdMap.set(key, skill.id)
			})
		}

		return skillIdMap
	},

	/**
	 * Get skill ID from map
	 */
	getSkillId: (skillMap: Map<string, string>, name: string, category: string | null): string => {
		const key = `${category}:${name}`
		const skillId = skillMap.get(key)
		if (!skillId) {
			throw APIError.internal(`Skill not found in map: ${key}`)
		}
		return skillId
	}
}

/**
 * Section creation helpers
 */
const SectionCreators = {
	/**
	 * Create Education section
	 */
	createEducation: async (
		tx: TransactionType,
		userId: string,
		sectionId: string,
		data: EducationUpsertRequest,
		countryCodes: Set<string>
	): Promise<void> => {
		// Collect country code if present
		if (data.country_code) {
			countryCodes.add(data.country_code)
		}

		await tx.insert(educations).values({
			user_id: userId,
			resume_section_id: sectionId,
			institution_name: data.institution_name.trim(),
			field_of_study: data.field_of_study.trim(),
			degree: data.degree?.trim() || null,
			country_code: data.country_code || null,
			started_from_month: data.started_from_month || null,
			started_from_year: data.started_from_year || null,
			finished_at_month: data.finished_at_month || null,
			finished_at_year: data.finished_at_year || null,
			current: data.current ?? false,
			description: data.description?.trim() || null
		})
	},

	/**
	 * Create Experience section
	 */
	createExperience: async (
		tx: TransactionType,
		userId: string,
		sectionId: string,
		data: ExperienceUpsertRequest,
		countryCodes: Set<string>
	): Promise<void> => {
		// Collect country code if present
		if (data.country_code) {
			countryCodes.add(data.country_code)
		}

		const insertData: any = {
			user_id: userId,
			resume_section_id: sectionId,
			company_name: data.company_name.trim(),
			job_title: data.job_title.trim(),
			city: data.city?.trim() || null,
			country_code: data.country_code || null,
			started_from_month: data.started_from_month || null,
			started_from_year: data.started_from_year || null,
			finished_at_month: data.finished_at_month || null,
			finished_at_year: data.finished_at_year || null,
			current: data.current ?? false,
			description: data.description?.trim() || null
		}

		if (data.employment_type) {
			insertData.employment_type = data.employment_type
		}

		await tx.insert(experiences).values(insertData)
	},

	/**
	 * Create Project section
	 */
	createProject: async (tx: TransactionType, userId: string, sectionId: string, data: ProjectUpsertRequest, skillMap: Map<string, string>): Promise<void> => {
		// Insert project
		const [project] = await tx
			.insert(projects)
			.values({
				user_id: userId,
				resume_section_id: sectionId,
				name: data.name.trim(),
				category: data.category?.trim() || null,
				description: data.description?.trim() || null,
				role: data.role?.trim() || null,
				github_url: data.github_url || null,
				live_url: data.live_url || null,
				started_from_month: data.started_from_month || null,
				started_from_year: data.started_from_year || null,
				finished_at_month: data.finished_at_month || null,
				finished_at_year: data.finished_at_year || null,
				current: data.current ?? false
			})
			.returning()

		// Create M2M associations for skills_used
		if (data.skills_used && Array.isArray(data.skills_used) && data.skills_used.length > 0) {
			const projectSkillValues = data.skills_used.map((skill: SkillInput) => {
				const skillId = SkillHelpers.getSkillId(skillMap, skill.name.trim(), skill.category?.trim() || null)
				return {
					project_id: project.id,
					skill_id: skillId
				}
			})

			await tx.insert(projectSkills).values(projectSkillValues)
		}
	},

	/**
	 * Create Certification section
	 */
	createCertification: async (tx: TransactionType, userId: string, sectionId: string, data: CertificationUpsertRequest): Promise<void> => {
		await tx.insert(certifications).values({
			user_id: userId,
			resume_section_id: sectionId,
			name: data.name.trim(),
			issuing_organization: data.issuing_organization?.trim() || null,
			issue_date: data.issue_date || null,
			credential_url: data.credential_url || null
		})
	},

	/**
	 * Create Skill section
	 */
	createSkill: async (tx: TransactionType, userId: string, sectionId: string, data: SkillSectionData, skillMap: Map<string, string>): Promise<void> => {
		if (!data.skills || !Array.isArray(data.skills) || data.skills.length === 0) {
			return
		}

		// Create proficiencies for each skill
		const proficiencyValues = data.skills.map(skill => {
			const skillId = SkillHelpers.getSkillId(skillMap, skill.name.trim(), skill.category?.trim() || null)
			return {
				resume_section_id: sectionId,
				skill_id: skillId,
				level: (skill.level as ProficiencyLevel) || null
			}
		})

		await tx.insert(proficiencies).values(proficiencyValues)
	}
}

/**
 * Bulk Replace Service
 * Public API
 */
export const BulkReplaceService = {
	/**
	 * Replace all sections of a resume
	 * Uses transaction for atomicity
	 */
	replaceResume: async ({id, sections}: ReplaceResumeRequest): Promise<ResumeWithSections> => {
		const userId = ResumeService.getAuthenticatedUserId()
		const resumeId = await ResumeService.resolveResumeId(id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Phase 1: Validate ALL data before transaction
		sections.forEach((section, idx) => {
			switch (section.type) {
				case ResumeSectionType.Education:
					Validators.validateEducation(section.data)
					break
				case ResumeSectionType.Experience:
					Validators.validateExperience(section.data)
					break
				case ResumeSectionType.Project:
					Validators.validateProject(section.data)
					break
				case ResumeSectionType.Certification:
					Validators.validateCertification(section.data)
					break
				case ResumeSectionType.Skill:
					Validators.validateSkill(section.data)
					break
				default:
					throw APIError.invalidArgument(`Invalid section type at index ${idx}: ${section.type}`)
			}
		})

		// Phase 2: Collect and resolve all skills (before transaction)
		const allSkills = SkillHelpers.collectAllSkills(sections)
		const skillMap = await SkillHelpers.bulkResolveSkills(allSkills)

		// Phase 3: Validate country codes (pre-fetch to fail fast)
		const countryCodes = new Set<string>()
		sections.forEach(section => {
			if (
				(section.type === ResumeSectionType.Education || section.type === ResumeSectionType.Experience) &&
				section.data.country_code
			) {
				countryCodes.add(section.data.country_code)
			}
		})

		// Validate all country codes exist
		await Promise.all(
			Array.from(countryCodes).map(async code => {
				try {
					await core.getCountry({code})
				} catch {
					throw APIError.invalidArgument(`Invalid country code: ${code}`)
				}
			})
		)

		// Phase 4: Execute transaction
		await db.transaction(async tx => {
			// Delete all existing sections (cascades to detail tables)
			await tx.delete(resumeSections).where(eq(resumeSections.resume_id, resumeId))

			// Create new sections in order
			for (let i = 0; i < sections.length; i++) {
				const section = sections[i]

				// Create ResumeSection
				const [newSection] = await tx
					.insert(resumeSections)
					.values({
						resume_id: resumeId,
						index: i,
						type: section.type
					})
					.returning()

				/*
				 * Create detail record based on type
				 * Data is already validated in Phase 1, safe to cast
				 */
				const countryCodesSet = new Set<string>()
				switch (section.type) {
					case ResumeSectionType.Education:
						await SectionCreators.createEducation(tx, userId, newSection.id, section.data as EducationUpsertRequest, countryCodesSet)
						break
					case ResumeSectionType.Experience:
						await SectionCreators.createExperience(tx, userId, newSection.id, section.data as ExperienceUpsertRequest, countryCodesSet)
						break
					case ResumeSectionType.Project:
						await SectionCreators.createProject(tx, userId, newSection.id, section.data as ProjectUpsertRequest, skillMap)
						break
					case ResumeSectionType.Certification:
						await SectionCreators.createCertification(tx, userId, newSection.id, section.data as CertificationUpsertRequest)
						break
					case ResumeSectionType.Skill:
						await SectionCreators.createSkill(tx, userId, newSection.id, section.data as SkillSectionData, skillMap)
						break
				}
			}
		})

		// Phase 5: Return updated resume
		return ResumeService.getResumeById({id: resumeId})
	}
}

