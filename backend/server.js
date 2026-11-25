const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const clinicalRoutes = require('./routes/clinical');
const fhirRoutes = require('./routes/fhir');
const interopRoutes = require('./routes/interop');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend requests
// Security headers
app.use(helmet());

// Only the MediLink frontend may call this API from a browser
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// At most 10 login attempts per IP every 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' }
});

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static documentation/assets if needed
app.use(express.static(path.join(__dirname, 'public')));

// Root Endpoint - System Health Check
app.get('/api/health', (req, res) => {
  // … unchanged …
});

// Setup API Routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/clinical', clinicalRoutes);
app.use('/api/fhir', fhirRoutes); // FHIR Interoperability Layer
app.use('/api/interop', interopRoutes); // Cross-hospital Integrations

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack);
  res.status(500).json({
    message: 'An unexpected server error occurred.',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// Start the server only when run directly (not when imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Health Interop Server running on port ${PORT}`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(` FHIR API Base: http://localhost:${PORT}/api/fhir`);
    console.log(` Health API Base: http://localhost:${PORT}/api/health`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
