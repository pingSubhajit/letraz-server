import {and, eq, isNull} from 'drizzle-orm'
import {APIError} from 'encore.dev/api'
import {db} from '@/services/resume/database'
import type {
	ListProjectsResponse,
	ProjectPathParams,
	ProjectResponse,
	ProjectUpsertRequest,
	ProjectWithIdParams,
	ProjectWithSkills,
	SkillInput
} from '@/services/resume/interface'
import {projects, projectSkills, resumeSections, ResumeSectionType, skills} from '@/services/resume/schema'
import {ResumeService} from '@/services/resume/service'

/**
 * Project Service
 * Handles all CRUD operations for projects
 *
 * Key responsibilities:
 * - Manage project lifecycle
 * - Handle M2M relationship with skills
 * - Clear and re-create skills_used on updates
 * - Validate URLs and date ranges
 */

/**
 * Helper Functions
 * Internal utilities for project operations
 */
const ProjectHelpers = {
	/**
	 * Get and verify project exists and belongs to resume
	 * Returns the project record
	 */
	getAndVerifyProject: async (id: string, resumeId: string) => {
		// Validate UUID format
		ResumeService.validateUUID(id, 'Project')

		// Get project
		const projectQuery = await db.select().from(projects).where(eq(projects.id, id)).limit(1)

		if (projectQuery.length === 0) {
			throw APIError.notFound(`Project with ID '${id}' not found`)
		}

		const project = projectQuery[0]

		// Verify project belongs to a section in this resume
		const sectionQuery = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.id, project.resume_section_id), eq(resumeSections.resume_id, resumeId)))
			.limit(1)

		if (sectionQuery.length === 0) {
			throw APIError.notFound(`Project with ID '${id}' not found in resume '${resumeId}'`)
		}

		return project
	},

	/**
	 * Get or create skills from skill input array
	 * Returns array of skill IDs
	 */
	resolveSkills: async (skillInputs: SkillInput[]): Promise<string[]> => {
		const skillIds: string[] = []

		for (const skillInput of skillInputs) {
			const skillName = skillInput.name.trim()
			const skillCategory = skillInput.category?.trim() || null

			// Get or create skill
			let skill = await db
				.select()
				.from(skills)
				.where(
					and(eq(skills.name, skillName), skillCategory ? eq(skills.category, skillCategory) : isNull(skills.category))
				)
				.limit(1)
				.then(rows => rows[0])

			if (!skill) {
				const [newSkill] = await db
					.insert(skills)
					.values({
						name: skillName,
						category: skillCategory,
						preferred: false
					})
					.returning()
				skill = newSkill
			}

			skillIds.push(skill.id)
		}

		return skillIds
	},

	/**
	 * Create project-skill associations
	 */
	createProjectSkills: async (projectId: string, skillIds: string[]) => {
		if (skillIds.length === 0) return

		await db.insert(projectSkills).values(skillIds.map(skillId => ({project_id: projectId, skill_id: skillId})))
	},

	/**
	 * Get skills for a project
	 */
	getProjectSkills: async (projectId: string) => {
		const skillRecords = await db
			.select({
				skill: skills
			})
			.from(projectSkills)
			.innerJoin(skills, eq(projectSkills.skill_id, skills.id))
			.where(eq(projectSkills.project_id, projectId))

		return skillRecords.map(r => r.skill)
	},

	/**
	 * Build clean project response with skills
	 */
	buildProjectResponse: (project: any, skills: any[]): ProjectWithSkills => {
		return {
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
			skills_used: skills
		}
	}
}

export const ProjectService = {
	/**
	 * List all projects for a resume
	 * Returns projects with skills_used populated
	 */
	listProjects: async ({resume_id}: ProjectPathParams): Promise<ListProjectsResponse> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get all project sections for this resume
		const sections = await db
			.select()
			.from(resumeSections)
			.where(and(eq(resumeSections.resume_id, resumeId), eq(resumeSections.type, ResumeSectionType.Project)))
			.orderBy(resumeSections.index)

		// Get projects for each section and their skills
		const projectsWithSkills = await Promise.all(
			sections.map(async section => {
				const projectQuery = await db
					.select()
					.from(projects)
					.where(eq(projects.resume_section_id, section.id))
					.limit(1)

				if (projectQuery.length === 0) return null

				const project = projectQuery[0]
				const skills = await ProjectHelpers.getProjectSkills(project.id)

				return ProjectHelpers.buildProjectResponse(project, skills)
			})
		)

		const validProjects = projectsWithSkills.filter((p): p is ProjectWithSkills => p !== null)

		return {projects: validProjects}
	},

	/**
	 * Get specific project by ID
	 */
	getProjectById: async ({resume_id, id}: ProjectWithIdParams): Promise<ProjectResponse> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get and verify project
		const project = await ProjectHelpers.getAndVerifyProject(id, resumeId)

		// Get skills
		const skills = await ProjectHelpers.getProjectSkills(project.id)

		return {
			project: ProjectHelpers.buildProjectResponse(project, skills)
		}
	},

	/**
	 * Create new project
	 * Auto-creates resume section and handles M2M skills
	 */
	createProject: async ({resume_id, ...data}: ProjectPathParams & ProjectUpsertRequest): Promise<ProjectResponse> => {
		const userId = ResumeService.getAuthenticatedUserId()
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Validate required field
		if (!data.name || data.name.trim() === '') {
			throw APIError.invalidArgument('Project name is required')
		}

		// Validate date ranges
		ResumeService.validateDateRange(data.started_from_month, data.started_from_year)
		ResumeService.validateDateRange(data.finished_at_month, data.finished_at_year)

		// Create section
		const sectionId = await ResumeService.createSectionForResume(resumeId, ResumeSectionType.Project)

		// Create project
		const [project] = await db
			.insert(projects)
			.values({
				user_id: userId,
				resume_section_id: sectionId,
				name: data.name.trim(),
				category: data.category?.trim() || null,
				description: data.description || null,
				role: data.role || null,
				github_url: data.github_url || null,
				live_url: data.live_url || null,
				started_from_month: data.started_from_month || null,
				started_from_year: data.started_from_year || null,
				finished_at_month: data.finished_at_month || null,
				finished_at_year: data.finished_at_year || null,
				current: data.current || false
			})
			.returning()

		// Handle skills_used (M2M)
		let projectSkills: any[] = []
		if (data.skills_used && data.skills_used.length > 0) {
			const skillIds = await ProjectHelpers.resolveSkills(data.skills_used)
			await ProjectHelpers.createProjectSkills(project.id, skillIds)
			projectSkills = await ProjectHelpers.getProjectSkills(project.id)
		}

		return {
			project: ProjectHelpers.buildProjectResponse(project, projectSkills)
		}
	},

	/**
	 * Update project
	 * Handles skills_used replacement (clear and re-create M2M)
	 */
	updateProject: async ({
		resume_id,
		id,
		...data
	}: ProjectWithIdParams & ProjectUpsertRequest): Promise<ProjectResponse> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get and verify project
		const existingProject = await ProjectHelpers.getAndVerifyProject(id, resumeId)

		// Validate date ranges if provided
		if (data.started_from_month !== undefined || data.started_from_year !== undefined) {
			ResumeService.validateDateRange(
				data.started_from_month ?? existingProject.started_from_month,
				data.started_from_year ?? existingProject.started_from_year
			)
		}
		if (data.finished_at_month !== undefined || data.finished_at_year !== undefined) {
			ResumeService.validateDateRange(
				data.finished_at_month ?? existingProject.finished_at_month,
				data.finished_at_year ?? existingProject.finished_at_year
			)
		}

		// Update project (partial update)
		const updateData: any = {}
		if (data.name !== undefined) updateData.name = data.name.trim()
		if (data.category !== undefined) updateData.category = data.category?.trim() || null
		if (data.description !== undefined) updateData.description = data.description
		if (data.role !== undefined) updateData.role = data.role
		if (data.github_url !== undefined) updateData.github_url = data.github_url
		if (data.live_url !== undefined) updateData.live_url = data.live_url
		if (data.started_from_month !== undefined) updateData.started_from_month = data.started_from_month
		if (data.started_from_year !== undefined) updateData.started_from_year = data.started_from_year
		if (data.finished_at_month !== undefined) updateData.finished_at_month = data.finished_at_month
		if (data.finished_at_year !== undefined) updateData.finished_at_year = data.finished_at_year
		if (data.current !== undefined) updateData.current = data.current

		const [updatedProject] = await db.update(projects).set(updateData).where(eq(projects.id, id)).returning()

		// Handle skills_used replacement if provided
		if (data.skills_used !== undefined) {
			// Delete existing associations
			await db.delete(projectSkills).where(eq(projectSkills.project_id, id))

			// Create new associations
			if (data.skills_used.length > 0) {
				const skillIds = await ProjectHelpers.resolveSkills(data.skills_used)
				await ProjectHelpers.createProjectSkills(id, skillIds)
			}
		}

		// Get current skills
		const skills = await ProjectHelpers.getProjectSkills(id)

		return {
			project: ProjectHelpers.buildProjectResponse(updatedProject, skills)
		}
	},

	/**
	 * Delete project
	 * Cascade deletes ResumeSection and M2M records
	 */
	deleteProject: async ({resume_id, id}: ProjectWithIdParams): Promise<void> => {
		const resumeId = await ResumeService.resolveResumeId(resume_id)
		await ResumeService.verifyResumeOwnership(resumeId)

		// Get and verify project
		const project = await ProjectHelpers.getAndVerifyProject(id, resumeId)

		// Delete section (cascades to project and M2M records via FK)
		await db.delete(resumeSections).where(eq(resumeSections.id, project.resume_section_id))
	}
}

