import {Service} from 'encore.dev/service'
import {middleware} from 'encore.dev/api'
import {handleError} from '@/services/utils/errors'
import {v4 as uuidv4} from 'uuid'

export default new Service('core', {
	middlewares: [
		middleware({}, async (req, next) => {
			try {
				return await next(req)
			} catch (err) {
				throw handleError(err, uuidv4())
			}
		})
	]
})
