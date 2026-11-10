# Audit — clean clone, 2026-11-04

## Running it from a fresh clone
- Node 24.18 / npm 11.16; MySQL 8.0. Clone is 88 KB (no node_modules committed).
- backend: `copy .env.example .env`, set DB_PASSWORD; `npm install` (npm audit: 6 vulnerabilities, 1 critical, at clone time); `npm run db:setup` creates schema and seeds mock data (skips seeding if the database already exists); `npm start` → port 5000, health check at /api/health.
- frontend: `npm install`, `npm run dev` → http://localhost:5173.
- FHIR base path is `/api/fhir` (README implies `/fhir`). All FHIR routes require a JWT. Token from `POST /api/auth/login`. Demo accounts: dr.doe@health.com, dr.smith@health.com, alice@health.com, bob@health.com, admin@health.com; password `password123`. Tokens expire after 24 h.
- Not in README: base path, auth requirement, demo accounts, the `routes/patients.js` file.

## Feature inventory
| Feature | How to reach | Status | Note |
| --- | --- | --- | --- |
| Health check | GET /api/health | works | |
| Login | POST /api/auth/login | works | returns JWT and user object |
| Doctor dashboard | log in as dr.doe | works | patient list, search, appointments; clinical entry saves and reappears |
| Patient dashboard | log in as alice | works | appointments, history, labs, prescriptions; booking works; doctor-entered data appears |
| RBAC enforcement | curl /api/patients with patient token / no token | works | patient token → 403 "Access denied"; no token → 401; server-side via authorizeRoles |
| Stale session handling | old token in localStorage | broken | 403 responses are stored where an array is expected; DoctorDashboard crashes (`patients.map is not a function`); needs error handling |
| FHIR Patient read | GET /api/fhir/Patient/{fhir_id} | works | **birthDate one day early** (timezone: DATE → JS Date → UTC; UI shows 15 June, FHIR emits 14 June, so the bug is in the mapper, not the data); no identifier |
| FHIR Observation search | GET /api/fhir/Observation?patient= | works | correct status/category/LOINC/UCUM structure; **every code is LOINC 1000-0 placeholder**; dates one day early |
| FHIR Condition search | GET /api/fhir/Condition?patient= | works | correct clinicalStatus/verificationStatus; **SNOMED code 000000 placeholder**; dates one day early |
| FHIR MedicationRequest search | GET /api/fhir/MedicationRequest?patient= | works | **RxNorm code 000000 placeholder**; status rule wrong (Lisinopril with 2027 end date shows `completed`); `requester` references Practitioner/doc-1 which has no endpoint; dates one day early |
| FHIR CapabilityStatement | GET /api/fhir/metadata | missing | |
| Per-resource reads advertised in Bundle fullUrl | /api/fhir/Observation/{id} etc. | missing | routes do not exist |
| External hospital search/import | doctor dashboard, Interoperability panel | works, but | the "external" patients (Sarah Connor, Bruce Wayne) are hard-coded in `routes/interop.js`; no second system is contacted; `hospitalSource` is not a FHIR field |
| External source unreachable | stop the external server, search | fixed | backend returns 502 with message; UI previously crashed, now shows the message |

## Security notes
- JWT secret and DB password read from .env (not committed). `.env.example` ships a real-looking JWT_SECRET; should be a placeholder.
- CORS origin is `*`.
- Passwords bcrypt-hashed; SQL uses parameter placeholders.
- No rate limiting, no token refresh, no audit log, no helmet.


## Provenance
MediLink is a personal project. The authentication, role-based access control and dashboard patterns come from what I learned in CSC702 (Computer, Web and Mobile Programming, Nile University of Nigeria), applied to a design of my own with AI assistance for boilerplate and debugging. The HL7 FHIR R4 layer and the cross-hospital import are my own additions; I drafted the resource mappers in routes/fhir.js with AI assistance and I'm am now validating and correcting them against the R4 specification (see docs/fhir-conformance.md).