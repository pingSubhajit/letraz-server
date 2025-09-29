import {Service} from 'encore.dev/service'
import {middleware, APIError} from 'encore.dev/api'
import {translateDatabaseError} from '@/shared/errors'

export default new Service('notifications')


