# MediLink — Interoperable Health Information System

A full-stack electronic health record system with role-based access for doctors and patients, an **HL7 FHIR R4 API**, and a cross-hospital record import that pulls a patient's FHIR resources from an external source into the local database. Built as a personal project to learn how health systems exchange data.

![Doctor dashboard](docs/screenshots/doctors-dashboard.png)

## What it does

- **Authentication and role-based access**: JWT login; patient, doctor and admin roles enforced server-side (a patient token is refused on clinician routes with 403).
- **Clinician dashboard**: patient directory with search, visits and schedule, and a per-patient EHR view where doctors record conditions, lab results and prescriptions.
- **Patient dashboard**: a patient sees their own appointments, conditions, medications and lab results, books appointments, and can view their record as FHIR JSON.
- **FHIR R4 API**: Patient, Observation (lab results), Condition (medical history) and MedicationRequest (prescriptions) served as FHIR resources, with `?patient=` search on the three clinical resources.
- **Cross-hospital import**: the FHIR Interop Console searches an external hospital source by surname, shows the FHIR Patient returned, and imports the patient with linked conditions, prescriptions and labs into MediLink.

| | |
| --- | --- |
| ![Patient dashboard](docs/screenshots/patient-dashboard.png) | ![Interop search](docs/screenshots/interop-search.png) |
| Patient view | Searching the external source |
| ![After import](docs/screenshots/interop-import.png) | ![FHIR Patient JSON](docs/screenshots/fhir-patient-json.png) |
| Imported record in the directory | Raw FHIR Patient resource |

## Architecture

React single-page app (Vite) → Express REST API with JWT and RBAC → MySQL 8. The FHIR module (`backend/routes/fhir.js`) maps MySQL rows to R4 resources on request. The interop module (`backend/routes/interop.js`) searches an external patient source and maps incoming FHIR resources into MediLink's tables. In the current version the external source is a mock inside the backend; replacing it with a separate FHIR server is the next step (see Roadmap).

## FHIR support

Base path: `/api/fhir`. All FHIR routes require a JWT (`Authorization: Bearer <token>`); obtain one from `POST /api/auth/login`.

| Resource | Endpoint | Source table | Notes |
| --- | --- | --- | --- |
| Patient | `GET /api/fhir/Patient/{fhir_id}` | patients | name, gender, birthDate, telecom, address |
| Observation | `GET /api/fhir/Observation?patient={fhir_id}` | lab_results | searchset Bundle; status, category laboratory, LOINC code, UCUM valueQuantity |
| Condition | `GET /api/fhir/Condition?patient={fhir_id}` | medical_histories | clinicalStatus, verificationStatus, SNOMED code, onsetDateTime |
| MedicationRequest | `GET /api/fhir/MedicationRequest?patient={fhir_id}` | prescriptions | status, intent, RxNorm code, dosageInstruction with timing |

Not yet supported: CapabilityStatement (`/metadata`), per-resource reads for Observation/Condition/MedicationRequest, FHIR create/update, Bundle transactions, SMART on FHIR / OAuth2. Sample responses are in `docs/fhir-samples/`.

## Run it

Prerequisites: Node.js 18+ and MySQL 8.0.

```bash
git clone https://github.com/JessicaAishatu/MediLink-Interoperable-Health-System.git
cd MediLink-Interoperable-Health-System/backend
copy .env.example .env        # then set DB_PASSWORD to your MySQL root password
npm install
npm run db:setup              # creates the health_system database, tables and demo data
npm start                     # API on http://localhost:5000
```

In a second terminal:

```bash
cd ../frontend
npm install
npm run dev                   # app on http://localhost:5173
```

Demo accounts (password `password123`): `dr.doe@health.com` (doctor), `alice@health.com` (patient), `bob@health.com` (patient), `admin@health.com` (admin). `npm run db:setup` skips seeding if the database already exists; drop it to reseed.

To call the FHIR API directly:

```bash
curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"dr.doe@health.com\",\"password\":\"password123\"}"
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/fhir/Patient/pat-alice-johnson
```

## Data

All patients, clinicians and records are fictional demo data created by `backend/scripts/setup-db.js`. No real person or institution is represented.

## Known issues

Found in a clean-clone audit (`docs/audit.md`) and being fixed:

- FHIR dates are emitted one day early (timezone conversion in the mapper; the UI shows the correct date).
- Terminology codes are placeholders (`000000`, `1000-0`) rather than real SNOMED, LOINC and RxNorm codes.
- MedicationRequest status rule is wrong for prescriptions with a future end date.
- `requester` references a Practitioner resource that has no endpoint.
- A stale token in browser storage causes a 403 that crashes the doctor dashboard instead of redirecting to login.
- CORS allows any origin; `.env.example` ships a non-placeholder JWT secret.

## Roadmap

1. Validate every resource against the HL7 FHIR R4 validator and publish the reports.
2. Add `GET /api/fhir/metadata` (CapabilityStatement) and per-resource reads.
3. Replace the in-process mock with a separate FHIR server so the import is a real two-system exchange.
4. Tests (Jest/supertest), security hardening, and a documented data mapping.

## Provenance

MediLink is a personal project. The authentication, role-based access control and dashboard patterns come from what I learned in CSC702 (Computer, Web and Mobile Programming, Nile University of Nigeria), applied to a design of my own with AI assistance for boilerplate and debugging. The HL7 FHIR R4 layer and the cross-hospital import are my own additions; the resource mappers were drafted with AI assistance and are being validated and corrected against the R4 specification.

## Licence

MIT (see `LICENSE`).
