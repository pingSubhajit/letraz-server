import {
	EmploymentType,
	ProcessStatus,
	ProficiencyLevel,
	ResumeSectionType,
	ResumeStatus
} from '@/services/resume/schema'
import {PaginatedResponse, PaginationParams} from '@/services/utils/pagination'
import {IsURL, Max, Min} from 'encore.dev/validate'
import type {User} from '@/services/identity/interface'
import type {Job} from '@/services/job/interface'

/**
 * ==========================================
 * BASE ENTITY INTERFACES
 * ==========================================
 */

/**
 * Resume Process Interface
 * Represents a process for tracking resume operations
 */
export interface ResumeProcess {
	id: string
	desc: string
	status: ProcessStatus
	status_details: string | null
	created_at: Date
	updated_at: Date
}

/**
 * Skill Interface
 * Represents a skill with category and metadata
 */
export interface Skill {
	id: string
	name: string
	category: string | null
	preferred: boolean
	created_at: Date
	updated_at: Date
}

/**
 * Country Reference Interface
 * Lightweight country data from core service
 */
export interface CountryReference {
	code: string
	name: string
}

/**
 * Resume Interface
 * Main resume entity
 */
export interface Resume {
	id: string
	user_id: string
	job_id: string | null
	base: boolean
	status: ResumeStatus | null
	thumbnail: string | null
	process_id: string | null
	thumbnail_process_id: string | null
	created_at: Date
	updated_at: Date
}

/**
 * Resume Section Interface
 * Polymorphic section container
 */
export interface ResumeSection {
	id: string
	resume_id: string
	index: number
	type: ResumeSectionType
	created_at: Date
	updated_at: Date
}

/**
 * Education Interface
 */
export interface Education {
	id: string
	user_id: string
	resume_section_id: string
	institution_name: string
	field_of_study: string
	degree: string | null
	country_code: string | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean
	description: string | null
	created_at: Date
	updated_at: Date
}

/**
 * Experience Interface
 */
export interface Experience {
	id: string
	user_id: string
	resume_section_id: string
	company_name: string
	job_title: string
	employment_type: EmploymentType
	city: string | null
	country_code: string | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean
	description: string | null
	created_at: Date
	updated_at: Date
}

/**
 * Project Interface
 */
export interface Project {
	id: string
	user_id: string
	resume_section_id: string
	name: string
	category: string | null
	description: string | null
	role: string | null
	github_url: string | null
	live_url: string | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean | null
	created_at: Date
	updated_at: Date
}

/**
 * Certification Interface
 */
export interface Certification {
	id: string
	user_id: string
	resume_section_id: string
	name: string
	issuing_organization: string | null
	issue_date: Date | null
	credential_url: string | null
	created_at: Date
	updated_at: Date
}

/**
 * Proficiency Interface
 * Skill with proficiency level for a resume
 */
export interface Proficiency {
	id: string
	skill_id: string
	resume_section_id: string
	level: ProficiencyLevel | null
	created_at: Date
	updated_at: Date
}

/**
 * ==========================================
 * NESTED RESPONSE INTERFACES
 * ==========================================
 */

/**
 * Project with Skills (clean response without internal fields)
 */
export interface ProjectWithSkills {
	id: string
	name: string
	category: string | null
	description: string | null
	role: string | null
	github_url: string | null
	live_url: string | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean | null
	skills_used: Skill[]
}

/**
 * Education with Country (clean response without internal fields)
 */
export interface EducationWithCountry {
	id: string
	institution_name: string
	field_of_study: string
	degree: string | null
	country: CountryReference | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean
	description: string | null
}

/**
 * Experience with Country (clean response without internal fields)
 */
export interface ExperienceWithCountry {
	id: string
	company_name: string
	job_title: string
	employment_type: EmploymentType
	city: string | null
	country: CountryReference | null
	started_from_month: number | null
	started_from_year: number | null
	finished_at_month: number | null
	finished_at_year: number | null
	current: boolean
	description: string | null
}

/**
 * Section Data Union Type
 */
export type SectionData =
	| {skills: ProficiencyWithSkill[]}
	| EducationWithCountry
	| ExperienceWithCountry
	| ProjectWithSkills
	| Certification
	| null

/**
 * Resume Section with Data
 * Full section with nested content
 */
export interface ResumeSectionWithData {
	id: string
	resume_id: string
	index: number
	type: ResumeSectionType
	data: SectionData
}

/**
 * User data for resume response (aliased from identity service)
 */
export type ResumeUser = User

/**
 * Job data for resume response (aliased from job service)
 */
export type ResumeJob = Job

/**
 * Full Resume Response
 * Complete resume with all nested sections
 */
export interface ResumeWithSections {
	id: string
	base: boolean
	user: ResumeUser
	job: ResumeJob | null
	status: ResumeStatus | null
	thumbnail: string | null
	sections: ResumeSectionWithData[]
	created_at: Date
	updated_at: Date
}

/**
 * Short Resume Response
 * Resume summary without sections
 */
export interface ResumeShort {
	id: string
	base: boolean
	user: ResumeUser
	job: ResumeJob | null
	status: ResumeStatus | null
	thumbnail: string | null
	created_at: Date
	updated_at: Date
}

/**
 * ==========================================
 * REQUEST INTERFACES - RESUME
 * ==========================================
 */

/**
 * Get Resume Request
 */
export interface GetResumeParams {
	/** Resume ID or 'base' for base resume */
	id: string
}

/**
 * Delete Resume Request
 */
export interface DeleteResumeParams {
	/** Resume ID (cannot be 'base') */
	id: string
}

/**
 * List Resumes Request
 */
export interface ListResumesParams extends PaginationParams {
	/** Filter by status */
	status?: ResumeStatus
	/** Filter by base resume */
	base?: boolean
}

/**
 * ==========================================
 * REQUEST INTERFACES - EDUCATION
 * ==========================================
 */

/**
 * Create/Update Education Request
 */
export interface EducationUpsertRequest {
	institution_name: string
	field_of_study: string
	degree?: string
	country_code?: string
	started_from_month?: number & Min<1> & Max<12>
	started_from_year?: number & Min<1900> & Max<2100>
	finished_at_month?: number & Min<1> & Max<12>
	finished_at_year?: number & Min<1900> & Max<2100>
	current?: boolean
	description?: string
}

/**
 * Education Path Params (for list/create)
 */
export interface EducationPathParams {
	resume_id: string
}

/**
 * Education Path Params with ID (for get/update/delete)
 */
export interface EducationWithIdParams {
	resume_id: string
	id: string
}

/**
 * ==========================================
 * REQUEST INTERFACES - EXPERIENCE
 * ==========================================
 */

/**
 * Create/Update Experience Request
 */
export interface ExperienceUpsertRequest {
	company_name: string
	job_title: string
	employment_type: EmploymentType
	city?: string
	country_code?: string
	started_from_month?: number & Min<1> & Max<12>
	started_from_year?: number & Min<1900> & Max<2100>
	finished_at_month?: number & Min<1> & Max<12>
	finished_at_year?: number & Min<1900> & Max<2100>
	current?: boolean
	description?: string
}

/**
 * Experience Path Params (for list/create)
 */
export interface ExperiencePathParams {
	resume_id: string
}

/**
 * Experience Path Params with ID (for get/update/delete)
 */
export interface ExperienceWithIdParams {
	resume_id: string
	id: string
}

/**
 * ==========================================
 * REQUEST INTERFACES - SKILLS
 * ==========================================
 */

/**
 * Skill Input (for creation)
 */
export interface SkillInput {
	name: string
	category?: string
}

/**
 * Add/Update Skill Request
 */
export interface SkillUpsertRequest {
	name: string
	category?: string
	level?: ProficiencyLevel
}

/**
 * Skill Query Params
 */
export interface SkillParams {
	resume_id: string
	id?: string
}

/**
 * ==========================================
 * REQUEST INTERFACES - PROJECTS
 * ==========================================
 */

/**
 * Create/Update Project Request
 */
export interface ProjectUpsertRequest {
	name: string
	category?: string
	description?: string
	role?: string
	github_url?: string & IsURL
	live_url?: string & IsURL
	skills_used?: SkillInput[]
	started_from_month?: number & Min<1> & Max<12>
	started_from_year?: number & Min<1900> & Max<2100>
	finished_at_month?: number & Min<1> & Max<12>
	finished_at_year?: number & Min<1900> & Max<2100>
	current?: boolean
}

/**
 * Path parameters for project endpoints
 */
export interface ProjectPathParams {
	/** Resume ID or 'base' */
	resume_id: string
}

/**
 * Path parameters for specific project operations
 */
export interface ProjectWithIdParams extends ProjectPathParams {
	/** Project ID */
	id: string
}

/**
 * ==========================================
 * REQUEST INTERFACES - CERTIFICATIONS
 * ==========================================
 */

/**
 * Create/Update Certification Request
 */
export interface CertificationUpsertRequest {
	name: string
	issuing_organization?: string
	issue_date?: Date
	credential_url?: string & IsURL
}

/**
 * Certification Query Params
 */
export interface CertificationParams {
	resume_id: string
	id?: string
}

/**
 * ==========================================
 * REQUEST INTERFACES - ADVANCED OPERATIONS
 * ==========================================
 */

/**
 * Rearrange Sections Request
 */
export interface RearrangeSectionsRequest {
	/** Resume ID */
	id: string
	/** Ordered array of section IDs */
	section_ids: string[]
}

/**
 * Section for Bulk Replace
 */
export interface SectionReplaceInput {
	type: ResumeSectionType
	data: Record<string, any>
}

/**
 * Bulk Replace Resume Request
 */
export interface ReplaceResumeRequest {
	/** Resume ID */
	id: string
	/** Complete ordered array of sections */
	sections: SectionReplaceInput[]
}

/**
 * ==========================================
 * RESPONSE INTERFACES
 * ==========================================
 */

/**
 * Resume Response (Single)
 */
export interface ResumeResponse {
	resume: ResumeWithSections
}

/**
 * Resume List Response (Paginated)
 */
export interface ListResumesResponse extends PaginatedResponse<ResumeShort> {}

/**
 * Education Response (Single)
 */
export interface EducationResponse {
	education: EducationWithCountry
}

/**
 * Education List Response
 */
export interface ListEducationsResponse {
	educations: EducationWithCountry[]
}

/**
 * Experience Response (Single)
 */
export interface ExperienceResponse {
	experience: ExperienceWithCountry
}

/**
 * Experience List Response
 */
export interface ListExperiencesResponse {
	experiences: ExperienceWithCountry[]
}

/**
 * Skill Categories Response
 */
export interface SkillCategoriesResponse {
	categories: string[]
}

/**
 * Project Response (Single)
 */
export interface ProjectResponse {
	project: ProjectWithSkills
}

/**
 * Project List Response
 */
export interface ListProjectsResponse {
	projects: ProjectWithSkills[]
}

/**
 * Certification Response (Single)
 */
export interface CertificationResponse {
	certification: Certification
}

/**
 * Certification List Response
 */
export interface ListCertificationsResponse {
	certifications: Certification[]
}

/**
 * ==========================================
 * SKILL & PROFICIENCY TYPES
 * ==========================================
 */

/**
 * Base Skill interface
 * Skills are shared resources across all resumes
 */
export interface Skill {
	/** Unique skill ID */
	id: string
	/** Skill category (e.g., 'Programming', 'Design', 'Languages') */
	category: string | null
	/** Skill name (e.g., 'TypeScript', 'Figma', 'Spanish') */
	name: string
	/** Whether this skill is preferred/featured */
	preferred: boolean
	/** Timestamps */
	created_at: Date
	updated_at: Date
}

/**
 * Proficiency with full skill details
 * Used for read operations
 */
export interface ProficiencyWithSkill {
	/** Proficiency record ID */
	id: string
	/** Full skill details */
	skill: Skill
	/** Proficiency level (optional) */
	level: ProficiencyLevel | null
}

/**
 * Request to add a skill to resume
 */
export interface AddSkillRequest {
	/** Skill name (required) */
	name: string
	/** Skill category (optional) */
	category?: string | null
	/** Proficiency level (optional) - validated against ProficiencyLevel enum */
	level?: string | null
}

/**
 * Request to update skill proficiency
 * Partial update - all fields optional
 */
export interface UpdateSkillRequest {
	/** Updated skill name */
	name?: string
	/** Updated skill category */
	category?: string | null
	/** Updated proficiency level - validated against ProficiencyLevel enum */
	level?: string | null
}

/**
 * Path parameters for skill endpoints
 */
export interface SkillPathParams {
	/** Resume ID or 'base' */
	resume_id: string
}

/**
 * Path parameters for specific skill operations
 */
export interface SkillWithIdParams extends SkillPathParams {
	/** Proficiency ID */
	id: string
}

/**
 * Single proficiency response
 */
export interface ProficiencyResponse {
	proficiency: ProficiencyWithSkill
}

/**
 * List of proficiencies response
 */
export interface ListProficienciesResponse {
	proficiencies: ProficiencyWithSkill[]
}

/**
 * Skill categories response
 */
export interface SkillCategoriesResponse {
	categories: string[]
}

/**
 * Global skills list response
 * Returns all skills in the system (not resume-specific)
 */
export interface GlobalSkillsResponse {
	skills: Skill[]
}

/**
 * Global skill categories response
 * Returns all unique categories from all skills
 */
export interface GlobalSkillCategoriesResponse {
	categories: string[]
}
