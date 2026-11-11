import ForbiddenError from "../models/errors/ForbiddenError.js";

const ALLOWED = [
    { method: 'POST',   path: '/api/sessions' },         
    { method: 'GET',    path: '/api/sessions/current' },  
    { method: 'DELETE', path: '/api/sessions/current' },  
    { method: 'PUT',    path: '/api/users/password' },    
];

const blockUntilPasswordChanged = (req, res, next) => {
    if (!req.user?.passwordToChange) return next();

    const isAllowed = ALLOWED.some(route => route.method === req.method && route.path === req.path);
    if (isAllowed) return next();

    return next(new ForbiddenError('PASSWORD_CHANGE_REQUIRED'));
};

export default blockUntilPasswordChanged;