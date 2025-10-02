import {api} from 'encore.dev/api'
import type {
	AddSkillRequest,
	DeleteResumeParams,
	EducationPathParams,
	EducationResponse,
	EducationUpsertRequest,
	EducationWithIdParams,
	ExperiencePathParams,
	ExperienceResponse,
	ExperienceUpsertRequest,
	ExperienceWithIdParams,
	GetResumeParams,
	GlobalSkillCategoriesResponse,
	GlobalSkillsResponse,
	ListEducationsResponse,
	ListExperiencesResponse,
	ListProficienciesResponse,
	ListProjectsResponse,
	ListResumesParams,
	ListResumesResponse,
	ProficiencyResponse,
	ProjectPathParams,
	ProjectResponse,
	ProjectUpsertRequest,
	ProjectWithIdParams,
	ResumeResponse,
	SkillCategoriesResponse,
	SkillPathParams,
	SkillWithIdParams,
	UpdateSkillRequest
} from '@/services/resume/interface'
import {ResumeService} from '@/services/resume/service'
import {EducationService} from '@/services/resume/services/education.service'
import {ExperienceService} from '@/services/resume/services/experience.service'
import {SkillService} from '@/services/resume/services/skill.service'
import {ProjectService} from '@/services/resume/services/project.service'

/**
 * List all resumes for authenticated user
 * Supports pagination and filtering by status/base
 * GET /resume
 */
export const listResumes = api(
	{method: 'GET', path: '/resume', auth: true, expose: true},
	async (params: ListResumesParams): Promise<ListResumesResponse> => {
		return ResumeService.listResumes(params)
	}
)

/**
 * Get resume by ID with all sections
 * Supports 'base' as ID to get base resume
 * GET /resume/:id
 */
export const getResume = api(
	{method: 'GET', path: '/resume/:id', auth: true, expose: true},
	async ({id}: GetResumeParams): Promise<ResumeResponse> => {
		const resume = await ResumeService.getResumeById({id})
		return {resume}
	}
)

/**
 * Delete resume by ID
 * Cannot delete base resume
 * DELETE /resume/:id
 */
export const deleteResume = api(
	{method: 'DELETE', path: '/resume/:id', auth: true, expose: true},
	async ({id}: DeleteResumeParams): Promise<void> => {
		await ResumeService.deleteResume({id})
	}
)

/**
 * ==========================================
 * EDUCATION ENDPOINTS
 * ==========================================
 */

/**
 * List all educations for a resume
 * GET /resume/:resume_id/education
 */
export const listEducations = api(
	{method: 'GET', path: '/resume/:resume_id/education', auth: true, expose: true},
	async ({resume_id}: EducationPathParams): Promise<ListEducationsResponse> => {
		return EducationService.listEducations({resume_id})
	}
)

/**
 * Get specific education by ID
 * GET /resume/:resume_id/education/:id
 */
export const getEducation = api(
	{method: 'GET', path: '/resume/:resume_id/education/:id', auth: true, expose: true},
	async ({resume_id, id}: EducationWithIdParams): Promise<EducationResponse> => {
		return EducationService.getEducationById({resume_id, id})
	}
)

/**
 * Create new education entry
 * POST /resume/:resume_id/education
 */
export const createEducation = api(
	{method: 'POST', path: '/resume/:resume_id/education', auth: true, expose: true},
	async ({resume_id, ...data}: EducationPathParams & EducationUpsertRequest): Promise<EducationResponse> => {
		return EducationService.createEducation({resume_id, ...data})
	}
)

/**
 * Update education entry
 * PATCH /resume/:resume_id/education/:id
 */
export const updateEducation = api(
	{method: 'PATCH', path: '/resume/:resume_id/education/:id', auth: true, expose: true},
	async ({resume_id, id, ...data}: EducationWithIdParams & EducationUpsertRequest): Promise<EducationResponse> => {
		return EducationService.updateEducation({resume_id, id, ...data})
	}
)

/**
 * Delete education entry
 * DELETE /resume/:resume_id/education/:id
 */
export const deleteEducation = api(
	{method: 'DELETE', path: '/resume/:resume_id/education/:id', auth: true, expose: true},
	async ({resume_id, id}: EducationWithIdParams): Promise<void> => {
		await EducationService.deleteEducation({resume_id, id})
	}
)

/**
 * ==========================================
 * EXPERIENCE ENDPOINTS
 * ==========================================
 */

/**
 * List all experiences for a resume
 * GET /resume/:resume_id/experience
 */
export const listExperiences = api(
	{method: 'GET', path: '/resume/:resume_id/experience', auth: true, expose: true},
	async ({resume_id}: ExperiencePathParams): Promise<ListExperiencesResponse> => {
		return ExperienceService.listExperiences({resume_id})
	}
)

/**
 * Get specific experience by ID
 * GET /resume/:resume_id/experience/:id
 */
export const getExperience = api(
	{method: 'GET', path: '/resume/:resume_id/experience/:id', auth: true, expose: true},
	async ({resume_id, id}: ExperienceWithIdParams): Promise<ExperienceResponse> => {
		return ExperienceService.getExperienceById({resume_id, id})
	}
)

/**
 * Create new experience entry
 * POST /resume/:resume_id/experience
 */
export const createExperience = api(
	{method: 'POST', path: '/resume/:resume_id/experience', auth: true, expose: true},
	async ({resume_id, ...data}: ExperiencePathParams & ExperienceUpsertRequest): Promise<ExperienceResponse> => {
		return ExperienceService.createExperience({resume_id, ...data})
	}
)

/**
 * Update experience entry
 * PATCH /resume/:resume_id/experience/:id
 */
export const updateExperience = api(
	{method: 'PATCH', path: '/resume/:resume_id/experience/:id', auth: true, expose: true},
	async ({resume_id, id, ...data}: ExperienceWithIdParams & ExperienceUpsertRequest): Promise<ExperienceResponse> => {
		return ExperienceService.updateExperience({resume_id, id, ...data})
	}
)

/**
 * Delete experience entry
 * DELETE /resume/:resume_id/experience/:id
 */
export const deleteExperience = api(
	{method: 'DELETE', path: '/resume/:resume_id/experience/:id', auth: true, expose: true},
	async ({resume_id, id}: ExperienceWithIdParams): Promise<void> => {
		await ExperienceService.deleteExperience({resume_id, id})
	}
)

/**
 * ==========================================
 * SKILL ENDPOINTS
 * ==========================================
 */

/**
 * List all skills/proficiencies for resume
 * GET /resume/:resume_id/skill
 */
export const listSkills = api(
	{method: 'GET', path: '/resume/:resume_id/skill', auth: true, expose: true},
	async ({resume_id}: SkillPathParams): Promise<ListProficienciesResponse> => {
		return SkillService.listSkills({resume_id})
	}
)

/**
 * Add skill to resume
 * POST /resume/:resume_id/skill
 */
export const addSkill = api(
	{method: 'POST', path: '/resume/:resume_id/skill', auth: true, expose: true},
	async ({resume_id, ...data}: SkillPathParams & AddSkillRequest): Promise<ProficiencyResponse> => {
		return SkillService.addSkill({resume_id, ...data})
	}
)

/**
 * Update skill proficiency
 * PATCH /resume/:resume_id/skill/:id
 */
export const updateSkill = api(
	{method: 'PATCH', path: '/resume/:resume_id/skill/:id', auth: true, expose: true},
	async ({resume_id, id, ...data}: SkillWithIdParams & UpdateSkillRequest): Promise<ProficiencyResponse> => {
		return SkillService.updateSkill({resume_id, id, ...data})
	}
)

/**
 * Remove skill from resume
 * DELETE /resume/:resume_id/skill/:id
 */
export const removeSkill = api(
	{method: 'DELETE', path: '/resume/:resume_id/skill/:id', auth: true, expose: true},
	async ({resume_id, id}: SkillWithIdParams): Promise<void> => {
		await SkillService.removeSkill({resume_id, id})
	}
)

/**
 * Get unique skill categories for resume
 * GET /resume/:resume_id/skill/categories
 */
export const getSkillCategories = api(
	{method: 'GET', path: '/resume/:resume_id/skill/categories', auth: true, expose: true},
	async ({resume_id}: SkillPathParams): Promise<SkillCategoriesResponse> => {
		return SkillService.getCategories({resume_id})
	}
)

/**
 * ==========================================
 * GLOBAL SKILL ENDPOINTS
 * ==========================================
 */

/**
 * Get all skills in the system
 * GET /skills
 * Useful for autocomplete/suggestions when adding skills
 */
export const getAllSkills = api(
	{method: 'GET', path: '/skills', auth: true, expose: true},
	async (): Promise<GlobalSkillsResponse> => {
		return SkillService.getAllSkills()
	}
)

/**
 * Get all unique skill categories in the system
 * GET /skills/categories
 * Useful for category filtering and autocomplete
 */
export const getAllSkillCategories = api(
	{method: 'GET', path: '/skills/categories', auth: true, expose: true},
	async (): Promise<GlobalSkillCategoriesResponse> => {
		return SkillService.getAllCategories()
	}
)

/**
 * ==========================================
 * PROJECT ENDPOINTS
 * ==========================================
 */

/**
 * List all projects for resume
 * GET /resume/:resume_id/project
 */
export const listProjects = api(
	{method: 'GET', path: '/resume/:resume_id/project', auth: true, expose: true},
	async ({resume_id}: ProjectPathParams): Promise<ListProjectsResponse> => {
		return ProjectService.listProjects({resume_id})
	}
)

/**
 * Get specific project
 * GET /resume/:resume_id/project/:id
 */
export const getProject = api(
	{method: 'GET', path: '/resume/:resume_id/project/:id', auth: true, expose: true},
	async ({resume_id, id}: ProjectWithIdParams): Promise<ProjectResponse> => {
		return ProjectService.getProjectById({resume_id, id})
	}
)

/**
 * Create project
 * POST /resume/:resume_id/project
 */
export const createProject = api(
	{method: 'POST', path: '/resume/:resume_id/project', auth: true, expose: true},
	async ({resume_id, ...data}: ProjectPathParams & ProjectUpsertRequest): Promise<ProjectResponse> => {
		return ProjectService.createProject({resume_id, ...data})
	}
)

/**
 * Update project
 * PATCH /resume/:resume_id/project/:id
 */
export const updateProject = api(
	{method: 'PATCH', path: '/resume/:resume_id/project/:id', auth: true, expose: true},
	async ({resume_id, id, ...data}: ProjectWithIdParams & ProjectUpsertRequest): Promise<ProjectResponse> => {
		return ProjectService.updateProject({resume_id, id, ...data})
	}
)

/**
 * Delete project
 * DELETE /resume/:resume_id/project/:id
 */
export const deleteProject = api(
	{method: 'DELETE', path: '/resume/:resume_id/project/:id', auth: true, expose: true},
	async ({resume_id, id}: ProjectWithIdParams): Promise<void> => {
		await ProjectService.deleteProject({resume_id, id})
	}
)

