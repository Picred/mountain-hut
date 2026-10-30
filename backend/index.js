import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';

import authenticationRoutes from './api/authenticationRoutes.js'
import slotRoutes from './api/slotRoutes.js';
import reservationRoutes from './api/reservationRoutes.js';

import { errorHandler } from './utils/errorHandler.js';
import capacityRoutes from './api/capacityRoutes.js';


const app = express();
const PORT = process.env.PORT || 3001;

// Log incoming HTTP requests.
app.use(morgan('dev'));

// Allow requests from the frontend.
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

// Parse incoming JSON request bodies.
app.use(express.json());

app.use(session({
    secret: 'segreto',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// API routes.
app.use(authenticationRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/reservations', reservationRoutes);
app.use(capacityRoutes);

// Centralized error handler (must be registered after the routes).
app.use(errorHandler);

// Start the HTTP server.
app.listen(PORT, () => {
    console.log(`Mountain Hut backend running on http://localhost:${PORT}`);
});
