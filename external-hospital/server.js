// Riverside General Hospital — a minimal FHIR R4 server that knows nothing about MediLink.
// Serves read and patient-scoped search for Patient, Condition, Observation, MedicationRequest.
const express = require('express');
const cors = require('cors');
const data = require('./data.json');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 4001;

const base = req => `${req.protocol}://${req.get('host')}/fhir`;
const notFound = (res, msg) => res.status(404).json({
  resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: msg }]
});
const bundle = (req, type, items) => ({
  resourceType: 'Bundle', type: 'searchset', total: items.length,
  link: [{ relation: 'self', url: `${req.protocol}://${req.get('host')}${req.originalUrl}` }],
  entry: items.map(r => ({ fullUrl: `${base(req)}/${type}/${r.id}`, resource: r, search: { mode: 'match' } }))
});
const forPatient = (list, req) => {
  const ref = (req.query.patient || '').replace('Patient/', '');
  return ref ? list.filter(r => r.subject.reference === `Patient/${ref}`) : list;
};

app.get('/fhir/metadata', (req, res) => res.json({
  resourceType: 'CapabilityStatement', status: 'active', date: '2026-11-10', kind: 'instance',
  fhirVersion: '4.0.1', format: ['json'],
  implementation: { description: 'Riverside General Hospital FHIR API (demo)', url: base(req) },
  rest: [{ mode: 'server', resource: [
    { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: [{ name: 'name', type: 'string' }] },
    { type: 'Condition', interaction: [{ code: 'search-type' }], searchParam: [{ name: 'patient', type: 'reference' }] },
    { type: 'Observation', interaction: [{ code: 'search-type' }], searchParam: [{ name: 'patient', type: 'reference' }] },
    { type: 'MedicationRequest', interaction: [{ code: 'search-type' }], searchParam: [{ name: 'patient', type: 'reference' }] }
  ]}]
}));

app.get('/fhir/Patient', (req, res) => {
  const q = (req.query.name || '').toLowerCase();
  const hits = data.patients.filter(p => !q || p.name.some(n =>
    n.family.toLowerCase().includes(q) || n.given.some(g => g.toLowerCase().includes(q))));
  res.json(bundle(req, 'Patient', hits));
});
app.get('/fhir/Patient/:id', (req, res) => {
  const p = data.patients.find(x => x.id === req.params.id);
  return p ? res.json(p) : notFound(res, `Patient ${req.params.id} not found`);
});
app.get('/fhir/Condition', (req, res) => res.json(bundle(req, 'Condition', forPatient(data.conditions, req))));
app.get('/fhir/Observation', (req, res) => res.json(bundle(req, 'Observation', forPatient(data.observations, req))));
app.get('/fhir/MedicationRequest', (req, res) => res.json(bundle(req, 'MedicationRequest', forPatient(data.medicationRequests, req))));

app.listen(PORT, () => console.log(`Riverside General FHIR server on http://localhost:${PORT}/fhir`));