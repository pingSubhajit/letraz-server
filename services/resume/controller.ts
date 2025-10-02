import {api} from 'encore.dev/api'
import type {
	DeleteResumeParams,
	EducationPathParams,
	EducationResponse,
	EducationUpsertRequest,
	EducationWithIdParams,
	GetResumeParams,
	ListEducationsResponse,
	ListResumesParams,
	ListResumesResponse,
	ResumeResponse
} from '@/services/resume/interface'
import {ResumeService} from '@/services/resume/service'
import {EducationService} from '@/services/resume/services/education.service'

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

