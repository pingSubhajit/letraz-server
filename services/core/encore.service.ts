import {Service} from 'encore.dev/service'
import {middleware} from 'encore.dev/api'
import {APIError} from 'encore.dev/api'
import {translateDatabaseError} from '@/shared/errors'

export default new Service('core', {
	middlewares: [
		middleware({}, async (req, next) => {
			try {
				return await next(req)
			} catch (err) {
				const translated = translateDatabaseError(err)
				if (translated instanceof APIError) {
					throw translated
				}
				throw err
			}
		})
	]
})
