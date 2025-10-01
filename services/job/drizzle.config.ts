import 'dotenv/config'
import {defineConfig} from 'drizzle-kit'

/**
 * Drizzle configuration for job service migrations
 */
export default defineConfig({
	out: 'migrations',
	schema: 'schema.ts',
	dialect: 'postgresql',
	dbCredentials: {
		url: 'postgresql://letraz-server-w3ti:local@127.0.0.1:9500/job?sslmode=disable'
	}
})

