# Security review

A review of MediLink's backend and frontend against common web-application risks, carried out on 2026-11-24. MediLink holds only fictional demo data; this review is about building the habits a system holding real health data would need.

## Checked and in place

| Area | Finding |
| --- | --- |
| Password storage | Passwords hashed with bcrypt in seed and registration; hashes are never returned by any API response. |
| SQL injection | All queries use parameter placeholders (`?`), including search filters; no string-built SQL with user input. |
| Authentication | JWT bearer tokens, 24-hour expiry, verified on every protected route. |
| Authorisation | Role checks enforced server-side (`authorizeRoles`), tested: no token → 401, patient token on a clinician route → 403. |
| Secrets in source control | `.env` is git-ignored; `git log --all -- backend/.env` returns no commits, so the file has never been in the repository's history. |

## Changed in this review

| Area | Before | After |
| --- | --- | --- |
| JWT secret | `.env.example` published a usable secret, and the running app used it | random 48-byte secret in `.env`; `.env.example` holds a placeholder and the command to generate one |
| CORS | any origin (`*`) | only `FRONTEND_ORIGIN` (default `http://localhost:5173`) |
| HTTP headers | Express defaults | `helmet` security headers |
| Brute-force login | unlimited attempts | 10 attempts per IP per 15 minutes on `/api/auth/login` |
| Dependencies | `npm audit --omit=dev`: 3 vulnerabilities (1 critical `proxy-addr`, 1 high `body-parser`, 1 moderate `qs`) |`npm audit fix` applied; `npm audit --omit=dev` now reports 0 vulnerabilities in production dependencies |
| Expired or invalid token in the browser | dashboard crashed on the error response; user had to clear browser storage by hand | global fetch handler clears the stored session and returns to login on 401/403 token errors |
| External source failure | UI crashed when the external FHIR server was down | backend returns 502 with a message; UI displays it |

## Still missing (would be required before any real deployment)

- HTTPS: everything runs over plain HTTP on localhost.
- Token storage in `localStorage` is readable by any script on the page; an httpOnly cookie with CSRF protection is safer.
- No refresh tokens; a session simply ends after 24 hours.
- No audit log of who viewed or changed which patient record, which health-records law generally requires.
- Patient-level access control: any doctor can see any patient; there is no care-relationship or consent check.
- Input validation is minimal (type and presence); no schema validation of request bodies.
- The FHIR API uses MediLink's own JWT rather than SMART on FHIR / OAuth2, so it cannot be used by third-party apps under a standard authorisation flow.
- The demo external hospital's FHIR API is unauthenticated.
- Development-only dependencies (Jest internals, `glob`, `minimatch`, `nodemon`) report 19 moderate advisories; the only fix is a breaking downgrade of Jest, and none of these packages ship with the running app.