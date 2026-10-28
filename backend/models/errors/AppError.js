/**
 * Base class for application errors.
 */
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = 'AppError';
        this.status = statusCode;
    }
}

export default AppError;