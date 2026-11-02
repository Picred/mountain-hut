import AppError from './AppError.js';

/**
 * Forbidden error (403).
 */
class ForbiddenError extends AppError {
    constructor(message) {
        super(message, 403);
        this.name = 'ForbiddenError';
    }
}

export default ForbiddenError;