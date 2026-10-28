import AppError from './AppError.js';

/**
 * Unauthorized error (401).
 */
class UnauthorizedError extends AppError {
    constructor(message) {
        super(message, 401);
        this.name = 'UnauthorizedError';
    }
}

export default UnauthorizedError;