export interface PaginationParams {
	page?: number
	page_size?: number
}

export interface PaginatedResponse<T> {
	data: T[]
	page: number
	page_size: number
	total: number
	has_next: boolean
	has_prev: boolean
}


