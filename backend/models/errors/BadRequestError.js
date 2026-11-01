import AppError from './AppError.js';

/**
 * Bad Request error (400).
 */
class BadRequestError extends AppError {
    constructor(message) {
        super(message, 400);
        this.name = 'BadRequestError';
    }
}

export default BadRequestError;