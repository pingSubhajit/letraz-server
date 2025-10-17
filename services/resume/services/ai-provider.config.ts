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
import {createGateway} from 'ai'

const aiGatewayKey = secret('AiGatewayKey')
const gateway = createGateway({
	apiKey: aiGatewayKey(),
})

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
		default: gateway('anthropic/claude-haiku-4.5'),
		fast: gateway('anthropic/claude-sonnet-4.5'), 
		powerful: gateway('anthropic/claude-sonnet-4.5')
	},
	openai: {
		default: gateway('openai/gpt-5-mini'),
		fast: gateway('openai/gpt-5-mini'),
		powerful: gateway('openai/gpt-5')
	},
	google: {
		default: gateway('google/gemini-1.5-pro'),
		fast: gateway('google/gemini-2.0-flash-exp'),
		powerful: gateway('google/gemini-1.5-pro')
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
		const model = AI_MODELS[selectedProvider][selectedTier]
		return model
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
