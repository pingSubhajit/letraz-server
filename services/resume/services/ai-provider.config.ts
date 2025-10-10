/**
 * AI Provider Configuration
 * Global configuration for switching between AI providers (OpenAI, Anthropic, Gemini)
 *
 * Change these values to quickly switch between providers and models
 */

import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import {createGoogleGenerativeAI} from '@ai-sdk/google'
import {secret} from 'encore.dev/config'

// Secrets for each provider
const anthropicApiKey = secret('ClaudeApiKey')
const openaiApiKey = secret('OpenAIAPIKey')
const googleApiKey = secret('GoogleAPIKey')

/**
 * Provider Types
 */
export type AIProvider = 'anthropic' | 'openai' | 'google'

/**
 * Model Configurations
 */
export const AI_MODELS = {
	anthropic: {
		default: 'claude-3-5-sonnet-20241022',
		fast: 'claude-3-5-sonnet-20241022', // Same model, fast enough
		powerful: 'claude-3-5-sonnet-20241022'
	},
	openai: {
		default: 'gpt-4o',
		fast: 'gpt-4o-mini',
		powerful: 'gpt-4-turbo'
	},
	google: {
		default: 'gemini-1.5-pro',
		fast: 'gemini-2.0-flash-exp',
		powerful: 'gemini-1.5-pro'
	}
} as const

/**
 * GLOBAL CONFIGURATION
 *
 * Change these values to switch provider/model globally
 */
export const AI_CONFIG = {
	/**
	 * Primary provider for resume tailoring
	 * Options: 'anthropic' | 'openai' | 'google'
	 */
	provider: 'anthropic' as AIProvider,

	/**
	 * Model selection
	 * Options: 'default' | 'fast' | 'powerful'
	 */
	modelTier: 'default' as 'default' | 'fast' | 'powerful',

	/**
	 * Temperature for generation (0.0 - 1.0)
	 * Lower = more deterministic, Higher = more creative
	 */
	temperature: 0.1,

	/**
	 * Max tokens for response
	 */
	maxTokens: 4096
}

/**
 * Provider Registry
 * Creates and caches provider instances
 */
class AIProviderRegistry {
	private providers: Map<AIProvider, any> = new Map()

	getProvider(provider: AIProvider) {
		if (!this.providers.has(provider)) {
			this.providers.set(provider, this.createProvider(provider))
		}
		return this.providers.get(provider)!
	}

	private createProvider(provider: AIProvider) {
		switch (provider) {
			case 'anthropic':
				return createAnthropic({
					apiKey: anthropicApiKey()
				})
			case 'openai':
				return createOpenAI({
					apiKey: openaiApiKey()
				})
			case 'google':
				return createGoogleGenerativeAI({
					apiKey: googleApiKey()
				})
		}
	}

	getModel(provider?: AIProvider, tier?: 'default' | 'fast' | 'powerful') {
		const selectedProvider = provider || AI_CONFIG.provider
		const selectedTier = tier || AI_CONFIG.modelTier
		const providerInstance = this.getProvider(selectedProvider)
		const modelId = AI_MODELS[selectedProvider][selectedTier]

		return providerInstance(modelId)
	}
}

// Export singleton instance
export const aiRegistry = new AIProviderRegistry()

/**
 * Helper function to get the configured model
 */
export function getAIModel(provider?: AIProvider, tier?: 'default' | 'fast' | 'powerful') {
	return aiRegistry.getModel(provider, tier)
}
