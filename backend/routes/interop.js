const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ------------------------------------------------------------------
// External FHIR source. Configured in .env, never in code:
//   EXTERNAL_FHIR_BASE=http://localhost:4001/fhir
//   EXTERNAL_HOSPITAL_NAME=Riverside General Hospital
// ------------------------------------------------------------------
const EXTERNAL_FHIR_BASE = process.env.EXTERNAL_FHIR_BASE || 'http://localhost:4001/fhir';
const EXTERNAL_HOSPITAL_NAME = process.env.EXTERNAL_HOSPITAL_NAME || 'Riverside General Hospital';

// Fetch a FHIR resource or Bundle from the external server. Throws with a
// status so the route can answer 404 (not there) vs 502 (unreachable/invalid).
async function fhirGet(path) {
  let response;
  try {
    response = await fetch(`${EXTERNAL_FHIR_BASE}${path}`, { headers: { Accept: 'application/fhir+json, application/json' } });
  } catch (err) {
    const e = new Error(`External FHIR server unreachable at ${EXTERNAL_FHIR_BASE}`); e.status = 502; throw e;
  }
  if (response.status === 404) { const e = new Error(`Not found on external server: ${path}`); e.status = 404; throw e; }
  if (!response.ok) { const e = new Error(`External server returned ${response.status} for ${path}`); e.status = 502; throw e; }
  const body = await response.json();
  if (!body || !body.resourceType) { const e = new Error(`External server returned non-FHIR content for ${path}`); e.status = 502; throw e; }
  return body;
}

const entries = bundle => (bundle.entry || []).map(e => e.resource).filter(Boolean);
const dateOnly = s => (typeof s === 'string' ? s.slice(0, 10) : null);
const conceptText = cc => (cc && (cc.text || (cc.coding && cc.coding[0] && cc.coding[0].display))) || null;
const firstCoding = cc => (cc && cc.coding && cc.coding[0]) || null;
const KNOWN_SYSTEMS = ['http://snomed.info/sct', 'http://loinc.org', 'http://www.nlm.nih.gov/research/umls/rxnorm'];

// 1. Search the external hospital's patients (Doctors only)
router.get('/external-search', authenticateToken, authorizeRoles('doctor', 'admin'), async (req, res) => {
  const { name, hospital } = req.query;
  try {
    // The UI's hospital filter: only one external source is connected in this version.
    if (hospital && hospital !== EXTERNAL_HOSPITAL_NAME) return res.json([]);

    const bundle = await fhirGet(`/Patient${name ? `?name=${encodeURIComponent(name)}` : ''}`);
    const patients = entries(bundle).map(p => ({
      ...p,
      meta: { ...(p.meta || {}), source: EXTERNAL_FHIR_BASE },
      hospitalSource: EXTERNAL_HOSPITAL_NAME   // UI label only; stripped before any FHIR output
    }));
    res.json(patients);
  } catch (error) {
    console.error('External search error:', error.message);
    res.status(error.status || 500).json({ message: error.message });
  }
});

// 2. Import an external patient and their clinical records (Doctors only).
// The browser sends which patient; the server re-fetches everything from the
// external FHIR API so the imported data is what the source holds, not what
// the client posted.
router.post('/external-import', authenticateToken, authorizeRoles('doctor', 'admin'), async (req, res) => {
  const { fhirPatient } = req.body;
  if (!fhirPatient || fhirPatient.resourceType !== 'Patient' || !fhirPatient.id) {
    return res.status(400).json({ message: 'Invalid payload. Expecting a FHIR Patient with an id.' });
  }

  const warnings = [];
  const imported = { conditions: 0, observations: 0, medications: 0 };
  let connection;
  try {
    // --- Fetch from the source ---
    const extId = fhirPatient.id;
    const patient = await fhirGet(`/Patient/${encodeURIComponent(extId)}`);
    const [condB, obsB, medB] = await Promise.all([
      fhirGet(`/Condition?patient=${encodeURIComponent(extId)}`),
      fhirGet(`/Observation?patient=${encodeURIComponent(extId)}`),
      fhirGet(`/MedicationRequest?patient=${encodeURIComponent(extId)}`)
    ]);

    // --- Map Patient ---
    const nameObj = (patient.name && patient.name[0]) || {};
    const firstName = (nameObj.given && nameObj.given[0]) || 'Unknown';
    const lastName = nameObj.family || 'Imported';
    if (!patient.birthDate) warnings.push('Patient has no birthDate; stored as NULL.');
    const birthDate = patient.birthDate || null;
    const fhirGender = patient.gender || 'unknown';
    const gender = fhirGender.charAt(0).toUpperCase() + fhirGender.slice(1);
    const phone = (patient.telecom && patient.telecom[0] && patient.telecom[0].value) || null;
    const address = (patient.address && patient.address[0] && patient.address[0].text) || null;
    const extIdentifier = patient.identifier && patient.identifier[0]
      ? `${patient.identifier[0].system || ''}|${patient.identifier[0].value || ''}` : null;
    // MediLink keeps the source id as fhir_id; the source identifier is noted on each record.
    const provenance = `Imported from ${EXTERNAL_HOSPITAL_NAME} (${extIdentifier || 'no identifier'}) on ${new Date().toISOString().slice(0, 10)}.`;

    connection = await db.getConnection();
    await connection.beginTransaction();

    let localPatientId;
    const [existing] = await connection.query('SELECT id FROM patients WHERE fhir_id = ?', [extId]);
    if (existing.length > 0) {
      localPatientId = existing[0].id;
      await connection.query(
        'UPDATE patients SET first_name = ?, last_name = ?, birth_date = ?, gender = ?, phone = ?, address = ? WHERE id = ?',
        [firstName, lastName, birthDate, gender, phone, address, localPatientId]);
      warnings.push('Patient already existed locally; profile updated, records de-duplicated.');
    } else {
      const [pRes] = await connection.query(
        'INSERT INTO patients (first_name, last_name, birth_date, gender, phone, address, fhir_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [firstName, lastName, birthDate, gender, phone, address, extId]);
      localPatientId = pRes.insertId;
    }

    // --- Map Condition -> medical_histories ---
    for (const c of entries(condB)) {
      const conditionName = conceptText(c.code);
      if (!conditionName) { warnings.push(`Condition ${c.id} skipped: no code text or display.`); continue; }
      const coding = firstCoding(c.code);
      if (coding && !KNOWN_SYSTEMS.includes(coding.system)) warnings.push(`Condition ${c.id}: unrecognised code system ${coding.system}; text kept, code ignored.`);
      const clin = (c.clinicalStatus && c.clinicalStatus.coding && c.clinicalStatus.coding[0] && c.clinicalStatus.coding[0].code) || 'active';
      const status = ['resolved', 'remission', 'inactive'].includes(clin) ? 'resolved' : 'active';
      const onset = dateOnly(c.onsetDateTime);
      const noteText = (c.note && c.note[0] && c.note[0].text) || '';
      const codeNote = coding ? ` [${coding.system} ${coding.code}]` : '';
      const notes = `${noteText}${noteText ? ' ' : ''}${provenance}${codeNote}`;
      const [exist] = await connection.query(
        'SELECT id FROM medical_histories WHERE patient_id = ? AND condition_name = ?', [localPatientId, conditionName]);
      if (exist.length === 0) {
        await connection.query(
          'INSERT INTO medical_histories (patient_id, condition_name, onset_date, status, notes) VALUES (?, ?, ?, ?, ?)',
          [localPatientId, conditionName, onset, status, notes]);
        imported.conditions++;
      }
    }

    // --- Map Observation -> lab_results ---
    for (const o of entries(obsB)) {
      const testName = conceptText(o.code);
      if (!testName) { warnings.push(`Observation ${o.id} skipped: no code text or display.`); continue; }
      const coding = firstCoding(o.code);
      if (coding && !KNOWN_SYSTEMS.includes(coding.system)) warnings.push(`Observation ${o.id}: unrecognised code system ${coding.system}.`);
      const testDate = dateOnly(o.effectiveDateTime) || dateOnly(o.issued);
      if (!testDate) { warnings.push(`Observation ${o.id} skipped: no effectiveDateTime.`); continue; }
      let value, unit;
      if (o.valueQuantity) { value = String(o.valueQuantity.value); unit = o.valueQuantity.unit || o.valueQuantity.code || 'N/A'; }
      else if (o.valueString != null) { value = o.valueString; unit = 'N/A'; }
      else if (o.valueCodeableConcept) { value = conceptText(o.valueCodeableConcept) || 'See source'; unit = 'N/A'; }
      else { value = 'Pending'; unit = 'N/A'; warnings.push(`Observation ${o.id}: no value present; stored as Pending.`); }
      const status = o.status === 'final' || o.status === 'amended' || o.status === 'corrected' ? 'completed' : 'pending';
      const refRange = (o.referenceRange && o.referenceRange[0] && o.referenceRange[0].text) || null;
      const [exist] = await connection.query(
        'SELECT id FROM lab_results WHERE patient_id = ? AND test_name = ? AND test_date = ?', [localPatientId, testName, testDate]);
      if (exist.length === 0) {
        await connection.query(
          'INSERT INTO lab_results (patient_id, test_name, test_date, result_value, result_unit, reference_range, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [localPatientId, testName, testDate, value, unit, refRange, status]);
        imported.observations++;
      }
    }

    // --- Map MedicationRequest -> prescriptions (attributed to the importing doctor) ---
    const doctorId = req.user.doctorId || 1;
    for (const m of entries(medB)) {
      const medName = conceptText(m.medicationCodeableConcept);
      if (!medName) { warnings.push(`MedicationRequest ${m.id} skipped: no medication text or display.`); continue; }
      const coding = firstCoding(m.medicationCodeableConcept);
      if (coding && !KNOWN_SYSTEMS.includes(coding.system)) warnings.push(`MedicationRequest ${m.id}: unrecognised code system ${coding.system}.`);
      const di = (m.dosageInstruction && m.dosageInstruction[0]) || {};
      const freqN = di.timing && di.timing.repeat && di.timing.repeat.frequency;
      const frequency = freqN === 2 ? 'Twice daily' : freqN === 3 ? 'Three times daily' : freqN === 1 ? 'Once daily' : (di.text || 'As directed');
      const dosage = di.text || 'See instructions';
      const startDate = dateOnly(m.authoredOn) || new Date().toISOString().slice(0, 10);
      if (!m.authoredOn) warnings.push(`MedicationRequest ${m.id}: no authoredOn; start_date set to today.`);
      const instructions = `${di.patientInstruction || di.text || ''} ${provenance}`.trim();
      const [exist] = await connection.query(
        'SELECT id FROM prescriptions WHERE patient_id = ? AND medication_name = ? AND start_date = ?', [localPatientId, medName, startDate]);
      if (exist.length === 0) {
        await connection.query(
          'INSERT INTO prescriptions (patient_id, doctor_id, medication_name, dosage, frequency, start_date, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [localPatientId, doctorId, medName, dosage, frequency, startDate, instructions]);
        imported.medications++;
      }
    }

    await connection.commit();
    res.json({
      message: `Imported ${firstName} ${lastName} from ${EXTERNAL_HOSPITAL_NAME}.`,
      patientId: localPatientId,
      source: { hospital: EXTERNAL_HOSPITAL_NAME, base: EXTERNAL_FHIR_BASE, externalId: extId, identifier: extIdentifier },
      imported,
      warnings
    });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch (_) { /* ignore */ } }
    console.error('Import error:', error.message);
    res.status(error.status || 500).json({ message: 'Failed to import external health records.', error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;