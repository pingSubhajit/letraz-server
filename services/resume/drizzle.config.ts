import 'dotenv/config'
import {defineConfig} from 'drizzle-kit'

export default defineConfig({
	out: 'migrations',
	schema: 'schema.ts',
	dialect: 'postgresql',
	dbCredentials: {
		url: 'postgresql://letraz-server-w3ti:local@127.0.0.1:9500/resume?sslmode=disable'
	}
})

