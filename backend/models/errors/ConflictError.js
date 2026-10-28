import AppError from './AppError.js';

/**
 * Conflict error (409).
 */
class ConflictError extends AppError {
    constructor(message) {
        super(message, 409);
        this.name = 'ConflictError';
    }
}

export default ConflictError;