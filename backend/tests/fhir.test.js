// Integration tests for MediLink's FHIR layer, RBAC and external import.
// Requires: MySQL running with the seeded health_system database (npm run db:setup),
// and the backend .env present. The external FHIR server does NOT need to be running;
// the import test points at a dead port on purpose.
process.env.EXTERNAL_FHIR_BASE = 'http://localhost:4999/fhir'; // nothing listens here

const request = require('supertest');
const app = require('../server');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let doctorToken;
let patientToken;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  expect(res.status).toBe(200);
  return res.body.token;
}

beforeAll(async () => {
  doctorToken = await login('dr.doe@health.com');
  patientToken = await login('alice@health.com');
});

describe('CapabilityStatement', () => {
  test('GET /api/fhir/metadata is public and declares R4', async () => {
    const res = await request(app).get('/api/fhir/metadata');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('CapabilityStatement');
    expect(res.body.fhirVersion).toBe('4.0.1');
    const types = res.body.rest[0].resource.map(r => r.type);
    expect(types).toEqual(expect.arrayContaining(['Patient', 'Observation', 'Condition', 'MedicationRequest']));
  });
});

describe('FHIR resources', () => {
  test('Patient read returns a valid-shaped Patient with ISO birthDate and identifier', async () => {
    const res = await request(app).get('/api/fhir/Patient/pat-alice-johnson')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('Patient');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.birthDate).toMatch(DATE_RE);
    expect(res.body.birthDate).toBe('1994-06-15'); // guards the timezone bug
    expect(res.body.identifier[0].system).toBeTruthy();
  });

  test('Observation search returns a searchset Bundle whose entries have status, subject and a real LOINC code', async () => {
    const res = await request(app).get('/api/fhir/Observation?patient=pat-alice-johnson')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.type).toBe('searchset');
    expect(res.body.link[0].relation).toBe('self');
    expect(res.body.entry.length).toBeGreaterThan(0);
    for (const e of res.body.entry) {
      const o = e.resource;
      expect(e.search.mode).toBe('match');
      expect(o.status).toBeTruthy();
      expect(o.subject.reference).toMatch(/^Patient\//);
      expect(o.effectiveDateTime).toMatch(DATE_RE);
      if (o.code.coding) {
        expect(o.code.coding[0].system).toBe('http://loinc.org');
        expect(o.code.coding[0].code).not.toBe('1000-0'); // placeholder is gone
      }
    }
  });

  test('Condition and MedicationRequest carry no placeholder codes', async () => {
    const [c, m] = await Promise.all([
      request(app).get('/api/fhir/Condition?patient=pat-alice-johnson').set('Authorization', `Bearer ${doctorToken}`),
      request(app).get('/api/fhir/MedicationRequest?patient=pat-alice-johnson').set('Authorization', `Bearer ${doctorToken}`)
    ]);
    expect(c.status).toBe(200);
    expect(m.status).toBe(200);
    const codes = [
      ...c.body.entry.map(e => e.resource.code),
      ...m.body.entry.map(e => e.resource.medicationCodeableConcept)
    ];
    for (const cc of codes) {
      if (cc.coding) expect(cc.coding[0].code).not.toBe('000000');
    }
  });

  test('Practitioner read resolves the requester reference', async () => {
    const res = await request(app).get('/api/fhir/Practitioner/doc-1')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('Practitioner');
    expect(res.body.name[0].family).toBeTruthy();
  });
});

describe('Authentication and RBAC', () => {
  test('a clinical route without a token returns 401', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
  });

  test('a patient token on a doctor-only route returns 403', async () => {
    const res = await request(app).get('/api/patients').set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  test('a doctor token on the same route returns 200 with an array', async () => {
    const res = await request(app).get('/api/patients').set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('External import', () => {
  test('rejects a payload that is not a FHIR Patient', async () => {
    const res = await request(app).post('/api/interop/external-import')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ fhirPatient: { resourceType: 'Observation', id: 'x' } });
    expect(res.status).toBe(400);
  });

  test('reports the external server as unreachable instead of crashing', async () => {
    const res = await request(app).post('/api/interop/external-import')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ fhirPatient: { resourceType: 'Patient', id: 'rg-10021' } });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unreachable/i);
  });
});