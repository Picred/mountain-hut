import AppError from './AppError.js';

/**
 * Not Found error (404).
 */
class NotFoundError extends AppError {
    constructor(message) {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}

export default NotFoundError;