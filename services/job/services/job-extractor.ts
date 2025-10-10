import FirecrawlApp from '@mendable/firecrawl-js'
import {z} from 'zod'
import log from 'encore.dev/log'
import {secret} from 'encore.dev/config'
import {isLinkedInURL, isLinkedInJobURL, convertToPublicLinkedInJobURL} from '../utils/url-detection'
import {LLMJobParser} from './llm-parser'

const firecrawlApiKey = secret('FirecrawlApiKey')
const brightDataApiKey = secret('BrightdataApiKey')
const brightDataDatasetId = secret('BrightdataDatasetId')

/*
 * Feature flag: Toggle between Firecrawl structured extraction vs markdown+LLM
 * Set to 'structured' for direct Firecrawl structured extraction
 * Set to 'markdown' for Firecrawl markdown + Claude LLM parsing
 */
const FIRECRAWL_EXTRACTION_MODE: 'structured' | 'markdown' = 'markdown'

/*
 * Zod schema for Firecrawl structured job extraction
 * Updated to handle the actual nested structure Firecrawl returns
 */
const FirecrawlJobSchema = z.object({
	// Support both flat and nested structures
	title: z.string().optional().describe('Job title or position name'),
	company_name: z.string().optional().describe('Company name (flat structure)'),

	// Nested company structure
	company: z.object({
		name: z.string().describe('Company name'),
		url: z.string().optional().describe('Company URL'),
		description: z.string().optional().describe('Company description')
	}).optional(),

	// Job details (could be nested or flat)
	job: z.object({
		title: z.string().optional().describe('Job title'),
		location: z.string().optional().describe('Job location'),
		description: z.string().optional().describe('Job description'),
		requirements: z.array(z.string()).optional().describe('Job requirements'),
		responsibilities: z.array(z.string()).optional().describe('Job responsibilities'),
		benefits: z.array(z.string()).optional().describe('Job benefits'),
		salary: z.object({
			min: z.number().optional(),
			max: z.number().optional(),
			currency: z.string().optional()
		}).optional()
	}).optional(),

	// Fallback flat fields
	location: z.string().optional().describe('Job location (city, state, remote, etc.)'),
	salary_min: z.number().optional().describe('Minimum salary amount'),
	salary_max: z.number().optional().describe('Maximum salary amount'),
	currency: z.string().optional().describe('Salary currency (USD, EUR, etc.)'),
	requirements: z.array(z.string()).optional().describe('Job requirements and qualifications'),
	responsibilities: z.array(z.string()).optional().describe('Job responsibilities and duties'),
	benefits: z.array(z.string()).optional().describe('Employee benefits and perks'),
	description: z.string().optional().describe('Brief job description or summary')
})

export interface JobExtractionResult {
	title: string;
	company_name: string;
	location?: string;
	currency?: string;
	salary_min?: number;
	salary_max?: number;
	requirements?: string[];
	description?: string;
	responsibilities?: string[];
	benefits?: string[];
}

export interface JobExtractionOptions {
	timeout?: number;
	retries?: number;
}

/**
 * Main job extraction service that implements the simplified flow:
 * - For LinkedIn job URLs: use BrightData
 * - For non-LinkedIn URLs: use Firecrawl
 */
export class JobExtractor {
	private firecrawl: FirecrawlApp

	private llmParser: LLMJobParser

	constructor() {
		// Log secret availability (without exposing values)
		log.info('JobExtractor initialization - checking secrets', {
			firecrawlApiKey: firecrawlApiKey() ? 'LOADED' : 'MISSING',
			brightDataApiKey: brightDataApiKey() ? 'LOADED' : 'MISSING',
			brightDataDatasetId: brightDataDatasetId() ? 'LOADED' : 'MISSING',
			firecrawlApiKeyLength: firecrawlApiKey()?.length || 0,
			brightDataApiKeyLength: brightDataApiKey()?.length || 0,
			brightDataDatasetIdLength: brightDataDatasetId()?.length || 0,
			extractionMode: FIRECRAWL_EXTRACTION_MODE
		})

		this.firecrawl = new FirecrawlApp({
			apiKey: firecrawlApiKey()
		})

		this.llmParser = new LLMJobParser()
	}

	/**
	 * Extract job information from a URL using the appropriate scraping method
	 */
	async extractJob(url: string, options: JobExtractionOptions = {}): Promise<JobExtractionResult> {
		log.info('Starting job extraction', {url, options})

		// Step 1: Determine URL type
		if (isLinkedInURL(url)) {
			// LinkedIn URL - check if it's a job
			if (isLinkedInJobURL(url)) {
				log.info('LinkedIn job URL detected, using BrightData', {url})
				return this.extractLinkedInJob(url, options)
			} else {
				throw new Error('LinkedIn URL is not a job posting')
			}
		} else {
			// Non-LinkedIn URL - use Firecrawl (choose mode based on feature flag)
			log.info('Non-LinkedIn URL detected, using Firecrawl', {url, mode: FIRECRAWL_EXTRACTION_MODE})

			if (FIRECRAWL_EXTRACTION_MODE === 'markdown') {
				return this.extractWithFirecrawlMarkdown(url, options)
			} else {
				return this.extractWithFirecrawl(url, options)
			}
		}
	}

	/**
	 * Extract LinkedIn job using BrightData API
	 */
	private async extractLinkedInJob(url: string, options: JobExtractionOptions): Promise<JobExtractionResult> {
		try {
			// Convert to public LinkedIn job URL format
			const publicUrl = convertToPublicLinkedInJobURL(url)

			log.info('Extracting LinkedIn job via BrightData', {
				originalUrl: url,
				publicUrl
			})

			// Call BrightData API
			const jobData = await this.callBrightDataAPI(publicUrl, options)

			log.info('BrightData API response', {jobData})

			// Use LLM to parse BrightData response (LinkedIn data needs AI parsing)
			return await this.parseBrightDataResponseWithLLM(jobData, publicUrl)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			const errorStack = error instanceof Error ? error.stack : undefined
			log.error(error as Error, 'Failed to extract LinkedIn job', {
				url,
				errorMessage,
				errorStack,
				errorType: error?.constructor?.name
			})
			throw new Error(`LinkedIn job extraction failed: ${errorMessage}`)
		}
	}

	/**
	 * Extract job information using Firecrawl
	 */
	private async extractWithFirecrawl(url: string, options: JobExtractionOptions): Promise<JobExtractionResult> {
		try {
			const apiKey = firecrawlApiKey()
			log.info('Extracting job via Firecrawl with structured extraction', {
				url,
				hasApiKey: !!apiKey,
				apiKeyLength: apiKey?.length || 0
			})

			// Use Firecrawl's native structured extraction with Zod schema
			const scrapeResult = await this.firecrawl.scrape(url, {
				formats: [{
					type: 'json',
					schema: FirecrawlJobSchema
				}],
				timeout: options.timeout || 60000, // Increased to 60 seconds
				waitFor: 5000 // Increased wait time for dynamic content
			})

			log.info('Firecrawl structured extraction result', {
				scrapeResult
			})

			if (!scrapeResult || !scrapeResult.json) {
				throw new Error('Firecrawl structured extraction failed - no data returned')
			}

			log.info('Firecrawl structured extraction successful', {
				url,
				extractedKeys: Object.keys(scrapeResult.json),
				rawData: scrapeResult.json,
				rawDataType: typeof scrapeResult.json,
				isString: typeof scrapeResult.json === 'string',
				fullRawData: JSON.stringify(scrapeResult.json, null, 2)
			})

			// Parse the JSON string if needed
			let parsedData: any
			if (typeof scrapeResult.json === 'string') {
				try {
					log.info(scrapeResult.json)
					parsedData = JSON.parse(scrapeResult.json)
					log.info('Successfully parsed JSON string from Firecrawl', {
						url,
						hasCompany: !!parsedData.company,
						hasJob: !!parsedData.job,
						companyName: parsedData.company?.name,
						jobTitle: parsedData.job?.title
					})
				} catch (parseError) {
					log.error(parseError as Error, 'Failed to parse JSON string from Firecrawl', {url})
					throw new Error('Invalid JSON structure returned from Firecrawl')
				}
			} else {
				parsedData = scrapeResult.json
			}

			// Firecrawl returns structured data directly!
			return this.parseFirecrawlStructuredData(parsedData as z.infer<typeof FirecrawlJobSchema>)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			log.error(error as Error, 'Failed to extract job with Firecrawl', {
				url,
				errorMessage,
				isTimeout: errorMessage.includes('timeout') || errorMessage.includes('timed out')
			})

			// Check if it's a timeout error
			if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
				throw new Error(`Firecrawl scraping timed out for ${url}. The page may be slow to load or have anti-bot protection.`)
			}

			throw new Error(`Firecrawl job extraction failed: ${errorMessage}`)
		}
	}

	/**
	 * Extract job information using Firecrawl markdown extraction + LLM parsing
	 * Alternative to structured extraction - uses markdown format for better compatibility
	 */
	private async extractWithFirecrawlMarkdown(url: string, options: JobExtractionOptions): Promise<JobExtractionResult> {
		try {
			const apiKey = firecrawlApiKey()
			log.info('Extracting job via Firecrawl markdown extraction', {
				url,
				hasApiKey: !!apiKey,
				apiKeyLength: apiKey?.length || 0
			})

			// Use Firecrawl to get markdown content
			const scrapeResult = await this.firecrawl.scrape(url, {
				formats: ['markdown'], // Get markdown format
				timeout: options.timeout || 60000,
				waitFor: 5000
			})

			if (!scrapeResult || !scrapeResult.markdown) {
				throw new Error('Firecrawl markdown extraction failed - no markdown content returned')
			}

			log.info('Firecrawl markdown extraction successful', {
				url,
				markdownLength: scrapeResult.markdown.length,
				hasMetadata: !!scrapeResult.metadata
			})

			// Use LLM to parse the markdown content
			return await this.llmParser.parseJobContent(scrapeResult.markdown, url, 'markdown')
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			log.error(error as Error, 'Failed to extract job with Firecrawl markdown', {
				url,
				errorMessage,
				isTimeout: errorMessage.includes('timeout') || errorMessage.includes('timed out')
			})

			if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
				throw new Error(`Firecrawl markdown scraping timed out for ${url}. The page may be slow to load or have anti-bot protection.`)
			}

			throw new Error(`Firecrawl markdown extraction failed: ${errorMessage}`)
		}
	}

	/**
	 * Call BrightData API for LinkedIn job scraping
	 */
	private async callBrightDataAPI(url: string, options: JobExtractionOptions): Promise<any> {
		const datasetId = brightDataDatasetId()
		const apiKey = brightDataApiKey()
		// Correct BrightData API format: dataset_id is a query parameter
		const brightDataUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&format=json`

		log.info('Making BrightData API call', {
			url: brightDataUrl,
			targetUrl: url,
			hasApiKey: !!apiKey,
			hasDatasetId: !!datasetId,
			apiKeyLength: apiKey?.length || 0,
			datasetIdLength: datasetId?.length || 0
		})

		// BrightData expects an array of objects with url field
		const requestBody = [
			{
				url: url
			}
		]

		try {
			const response = await fetch(brightDataUrl, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody),
				signal: AbortSignal.timeout(options.timeout || 60000)
			})

			if (!response.ok) {
				const errorText = await response.text()
				log.error('BrightData API error response', {
					status: response.status,
					statusText: response.statusText,
					errorBody: errorText
				})
				throw new Error(`BrightData API error: ${response.status} ${response.statusText} - ${errorText}`)
			}

			const data = await response.json() as any
			log.info('BrightData API response received', {
				dataKeys: Object.keys(data || {}),
				dataType: typeof data,
				hasSnapshotId: !!data.snapshot_id
			})

			// BrightData /trigger returns a snapshot_id, we need to poll for the actual data
			if (data.snapshot_id) {
				log.info('BrightData scrape triggered, polling for results', {
					snapshotId: data.snapshot_id
				})
				return await this.pollBrightDataSnapshot(data.snapshot_id)
			}

			return data
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			log.error(error as Error, 'BrightData API call failed', {
				url: brightDataUrl,
				targetUrl: url,
				errorMessage
			})
			throw error
		}
	}

	/**
	 * Poll BrightData snapshot until data is ready
	 */
	private async pollBrightDataSnapshot(snapshotId: string): Promise<any> {
		const apiKey = brightDataApiKey()
		const snapshotUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`
		const maxAttempts = 30 // Max 30 attempts (5 minutes with 10s intervals)
		const pollInterval = 10000 // 10 seconds

		log.info('Starting BrightData snapshot polling', {
			snapshotId,
			snapshotUrl,
			maxAttempts,
			pollInterval
		})

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				log.info('Polling BrightData snapshot', {
					attempt,
					maxAttempts,
					snapshotId
				})

				const response = await fetch(snapshotUrl, {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${apiKey}`
					}
				})

				if (!response.ok) {
					const errorText = await response.text()
					log.warn('BrightData snapshot poll failed', {
						attempt,
						status: response.status,
						statusText: response.statusText,
						errorBody: errorText
					})

					// If it's a 404, the snapshot might not be ready yet, continue polling
					if (response.status === 404 && attempt < maxAttempts) {
						await new Promise(resolve => setTimeout(resolve, pollInterval))
						continue
					}

					throw new Error(`BrightData snapshot error: ${response.status} ${response.statusText}`)
				}

				const snapshotData = await response.json() as any

				log.info('BrightData snapshot response', {
					attempt,
					hasData: !!snapshotData,
					dataKeys: Object.keys(snapshotData || {}),
					status: snapshotData.status,
					hasJobData: !!snapshotData.job_posting_id || !!snapshotData.job_title
				})

				// BrightData returns job data directly without status field when ready
				// Check if we have actual job data (e.g., job_posting_id or job_title)
				if (snapshotData.job_posting_id || snapshotData.job_title) {
					log.info('BrightData snapshot ready with job data', {
						snapshotId,
						jobTitle: snapshotData.job_title,
						companyName: snapshotData.company_name
					})
					return snapshotData
				}

				// Handle status-based responses
				if (snapshotData.status === 'ready' && snapshotData.data) {
					log.info('BrightData snapshot ready', {
						snapshotId,
						dataLength: Array.isArray(snapshotData.data) ? snapshotData.data.length : 'not-array'
					})
					return Array.isArray(snapshotData.data) ? snapshotData.data[0] : snapshotData.data
				}

				// If still running, wait and try again
				if (snapshotData.status === 'running') {
					if (attempt < maxAttempts) {
						log.info('BrightData snapshot still running, waiting...', {
							attempt,
							maxAttempts,
							waitingSeconds: pollInterval / 1000
						})
						await new Promise(resolve => setTimeout(resolve, pollInterval))
						continue
					} else {
						throw new Error('BrightData snapshot still running after max attempts')
					}
				}

				// If failed
				if (snapshotData.status === 'failed') {
					throw new Error(`BrightData snapshot failed: ${snapshotData.error || snapshotData.message || 'Unknown error'}`)
				}

				// If no job data and no status, might still be processing - wait and retry
				if (attempt < maxAttempts) {
					log.info('BrightData snapshot not ready yet, waiting...', {
						attempt,
						status: snapshotData.status,
						message: snapshotData.message
					})
					await new Promise(resolve => setTimeout(resolve, pollInterval))
					continue
				}

			} catch (error) {
				if (attempt === maxAttempts) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error'
					log.error(error as Error, 'BrightData snapshot polling failed after max attempts', {
						snapshotId,
						attempts: maxAttempts,
						errorMessage
					})
					throw new Error(`Failed to get BrightData snapshot after ${maxAttempts} attempts: ${errorMessage}`)
				}

				// For other attempts, log and continue
				log.warn('BrightData snapshot poll error, retrying...', {
					attempt,
					error: error instanceof Error ? error.message : 'Unknown error'
				})
				await new Promise(resolve => setTimeout(resolve, pollInterval))
			}
		}

		throw new Error(`BrightData snapshot polling timed out after ${maxAttempts} attempts`)
	}


	/**
	 * Parse Firecrawl structured data
	 * Firecrawl returns exactly what we need in the right format!
	 */
	private parseFirecrawlStructuredData(data: z.infer<typeof FirecrawlJobSchema>): JobExtractionResult {
		// Extract data from both nested and flat structures
		const title = data.job?.title || data.title || '<TITLE_NOT_FOUND>'
		const company_name = data.company?.name || data.company_name || '<COMPANY_NOT_FOUND>'
		const location = data.job?.location || data.location || undefined
		const description = data.job?.description || data.description || undefined
		const requirements = data.job?.requirements || data.requirements || undefined
		const responsibilities = data.job?.responsibilities || data.responsibilities || undefined
		const benefits = data.job?.benefits || data.benefits || undefined

		// Handle salary from nested or flat structure
		const currency = data.job?.salary?.currency || data.currency || undefined
		const salary_min = data.job?.salary?.min || data.salary_min || undefined
		const salary_max = data.job?.salary?.max || data.salary_max || undefined

		log.info('Parsing Firecrawl structured data', {
			title,
			company_name,
			location,
			hasRequirements: !!requirements?.length,
			hasResponsibilities: !!responsibilities?.length,
			hasBenefits: !!benefits?.length,
			hasNestedCompany: !!data.company,
			hasNestedJob: !!data.job,
			rawFirecrawlData: data
		})

		// Mapping from Firecrawl's structure to our format
		return {
			title,
			company_name,
			location,
			currency,
			salary_min,
			salary_max,
			requirements,
			description,
			responsibilities,
			benefits
		}
	}

	/**
	 * Parse BrightData response using LLM
	 * LinkedIn data is complex and needs AI parsing
	 */
	private async parseBrightDataResponseWithLLM(data: any, url: string): Promise<JobExtractionResult> {
		log.info('Parsing BrightData response with LLM', {
			dataKeys: Object.keys(data || {}),
			url
		})

		// Convert BrightData response to text content for LLM processing
		const textContent = this.convertBrightDataToText(data)

		// Use LLM to parse the LinkedIn data (HTML content from BrightData)
		return await this.llmParser.parseJobContent(textContent, url, 'html')
	}

	/**
	 * Convert BrightData response to HTML format for LLM processing
	 * BrightData returns raw HTML content from LinkedIn job pages
	 */
	private convertBrightDataToText(data: any): string {
		// BrightData returns job data with various HTML fields
		// We want to extract the raw HTML content and pass it to Claude for parsing

		log.info('Converting BrightData response to HTML', {
			dataKeys: Object.keys(data || {}),
			hasJobDescription: !!data.job_description_formatted || !!data.job_description,
			hasSummary: !!data.job_summary
		})

		// Combine all HTML content from BrightData response
		const htmlParts = []

		// Add structured fields as HTML
		if (data.job_title) {
			htmlParts.push(`<h1>Job Title: ${data.job_title}</h1>`)
		}
		if (data.company_name) {
			htmlParts.push(`<h2>Company: ${data.company_name}</h2>`)
		}
		if (data.job_location) {
			htmlParts.push(`<p>Location: ${data.job_location}</p>`)
		}
		if (data.job_seniority_level) {
			htmlParts.push(`<p>Seniority Level: ${data.job_seniority_level}</p>`)
		}
		if (data.job_employment_type) {
			htmlParts.push(`<p>Employment Type: ${data.job_employment_type}</p>`)
		}
		if (data.base_salary) {
			htmlParts.push(`<p>Salary: ${JSON.stringify(data.base_salary)}</p>`)
		}

		// Add the main job description (this is usually HTML formatted)
		if (data.job_description_formatted) {
			htmlParts.push('<div class="job-description">')
			htmlParts.push(data.job_description_formatted)
			htmlParts.push('</div>')
		} else if (data.job_description) {
			htmlParts.push('<div class="job-description">')
			htmlParts.push(data.job_description)
			htmlParts.push('</div>')
		}

		// Add job summary if available
		if (data.job_summary) {
			htmlParts.push('<div class="job-summary">')
			htmlParts.push(`<h3>Summary:</h3><p>${data.job_summary}</p>`)
			htmlParts.push('</div>')
		}

		// Combine all parts
		const htmlContent = htmlParts.join('\n')

		log.info('BrightData HTML content prepared', {
			htmlLength: htmlContent.length,
			partsCount: htmlParts.length
		})

		return htmlContent || 'No HTML content available from BrightData'
	}

}
