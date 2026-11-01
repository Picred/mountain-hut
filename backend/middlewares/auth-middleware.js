import UnauthorizedError from "../models/errors/UnauthorizedError.js";

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
    return next(new UnauthorizedError('UNAUTHORIZED'))
};

export default ensureAuthenticated