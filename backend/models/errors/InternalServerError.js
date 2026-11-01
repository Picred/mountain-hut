import AppError from './AppError.js';

/**
 * Internal Server Error (500).
 */
class InternalServerError extends AppError {
    constructor(message = 'INTERNAL_SERVER_ERROR') {
        super(message, 500);
        this.name = 'InternalServerError';
    }
}

export default InternalServerError;