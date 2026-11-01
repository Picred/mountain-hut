import AppError from '../models/errors/AppError.js';

/**
 * Centralized Express error-handling middleware.
 *
 * Known application errors return their HTTP status and message.
 * Unexpected errors are logged and return a generic 500 response.
 */
export const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.status).json({
            error: err.message
        });
    }

    // Log unexpected errors without exposing internal details to clients.
    console.error('Unexpected server error:', err);

    return res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR'
    });
};