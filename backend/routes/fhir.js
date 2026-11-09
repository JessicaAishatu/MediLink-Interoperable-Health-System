const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// Terminology lookup: local display text -> standard code. Verified against
// LOINC 2.83, SNOMED CT International 2025-02, RxNorm 03/2026. Anything not
// listed is emitted as text only (no coding), which is valid FHIR.
const LOINC = {
  'Hemoglobin A1c':                   { code: '4548-4',  display: 'Hemoglobin A1c/Hemoglobin.total in Blood' },
  'Serum Cholesterol':                { code: '2093-3',  display: 'Cholesterol [Mass/volume] in Serum or Plasma' },
  'Complete Blood Count (CBC)':       { code: '58410-2', display: 'CBC panel - Blood by Automated count' },
  'TSH (Thyroid Stimulating Hormone)':{ code: '3016-3',  display: 'Thyrotropin [Units/volume] in Serum or Plasma' },
  'Vitamin D, 25-Hydroxy':            { code: '62292-8',  display: '25-Hydroxyvitamin D3+25-Hydroxyvitamin D2 [Mass/volume] in Serum or Plasma' }
};
const SNOMED = {
  'Essential Hypertension':   { code: '59621000',  display: 'Essential hypertension' },
  'Mild Seasonal Allergy':    { code: '367498001', display: 'Seasonal allergic rhinitis' },
  'Type 2 Diabetes Mellitus': { code: '44054006',  display: 'Diabetes mellitus type 2' },
  'Asthma':                   { code: '195967001', display: 'Asthma' }
};
const RXNORM = {
  'Lisinopril 10mg':   { code: '314076', display: 'lisinopril 10 MG Oral Tablet' },
  'Metformin 500mg':   { code: '861007', display: 'metformin hydrochloride 500 MG Oral Tablet' },
  'Atorvastatin 20mg': { code: '617310', display: 'atorvastatin 20 MG Oral Tablet' },
  'Amoxicillin 250mg': { code: '308182', display: 'amoxicillin 250 MG Oral Capsule' }
};

// Build a CodeableConcept: coding only when we have a verified code.
function codeable(system, lookup, text) {
  const hit = lookup[text];
  return hit ? { coding: [{ system, code: hit.code, display: hit.display }], text }
             : { text };
}

// Format a MySQL DATE/DATETIME as a FHIR date without timezone shift.
function fhirDate(d) {
  if (!d) return undefined;
  if (typeof d === 'string') return d.slice(0, 10);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// HELPER: Convert database Patient to FHIR Patient resource
const mapToFHIRPatient = (p) => {
  return {
    resourceType: 'Patient',
    id: p.fhir_id,
    active: true,
    identifier: [{ system: 'http://medilink.example/mrn', value: p.fhir_id }],
    name: [
      {
        use: 'official',
        family: p.last_name,
        given: [p.first_name]
      }
    ],
    telecom: p.phone ? [
      {
        system: 'phone',
        value: p.phone,
        use: 'mobile'
      }
    ] : [],
    gender: p.gender ? p.gender.toLowerCase() : 'unknown',
    birthDate: fhirDate(p.birth_date),
    address: p.address ? [
      {
        text: p.address
      }
    ] : [],
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Patient']
    }
  };
};

// HELPER: Convert database Lab Result to FHIR Observation resource
const mapToFHIRObservation = (lr, patientFhirId) => {
  const isNumeric = !isNaN(parseFloat(lr.result_value)) && isFinite(lr.result_value);
  
  const fhirObs = {
    resourceType: 'Observation',
    id: `obs-${lr.id}`,
    status: lr.status === 'completed' ? 'final' : 'registered',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory'
          }
        ]
      }
    ],
    code: codeable('http://loinc.org', LOINC, lr.test_name),
    subject: {
      reference: `Patient/${patientFhirId}`
    },
    performer: [{ reference: 'Organization/medilink', display: 'MediLink Hospital Laboratory' }],
    effectiveDateTime: fhirDate(lr.test_date),
  };

  if (lr.status === 'completed') {
    if (isNumeric) {
      fhirObs.valueQuantity = {
        value: parseFloat(lr.result_value),
        unit: lr.result_unit,
        system: 'http://unitsofmeasure.org',
        code: lr.result_unit
      };
    } else {
      fhirObs.valueString = lr.result_value;
    }

    if (lr.reference_range) {
      fhirObs.referenceRange = [
        {
          text: lr.reference_range
        }
      ];
    }
  }

  return fhirObs;
};

// HELPER: Convert database Prescription to FHIR MedicationRequest resource
const mapToFHIRMedicationRequest = (pr, patientFhirId) => {
  return {
    resourceType: 'MedicationRequest',
    id: `medrx-${pr.id}`,
    status: pr.end_date && new Date(pr.end_date) < new Date() ? 'completed' : 'active',
    intent: 'order',
    medicationCodeableConcept: codeable('http://www.nlm.nih.gov/research/umls/rxnorm', RXNORM, pr.medication_name),
    subject: {
      reference: `Patient/${patientFhirId}`
    },
    authoredOn: fhirDate(pr.start_date),
    requester: pr.doctor_last ? {
      reference: `Practitioner/doc-${pr.doctor_id}`,
      display: `Dr. ${pr.doctor_first} ${pr.doctor_last}`
    } : undefined,
    dosageInstruction: [
      {
        text: `${pr.dosage} ${pr.frequency}`,
        timing: {
          repeat: {
            frequency: pr.frequency.includes('Twice') ? 2 : 1,
            period: 1,
            periodUnit: 'd'
          }
        },
        patientInstruction: pr.instructions
      }
    ]
  };
};

// HELPER: Convert database Condition to FHIR Condition resource
const mapToFHIRCondition = (c, patientFhirId) => {
  return {
    resourceType: 'Condition',
    id: `cond-${c.id}`,
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: c.status === 'active' ? 'active' : 'resolved'
        }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed'
        }
      ]
    },
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis'
          }
        ]
      }
    ],
    code: codeable('http://snomed.info/sct', SNOMED, c.condition_name),
    subject: {
      reference: `Patient/${patientFhirId}`
    },
    onsetDateTime: fhirDate(c.onset_date),
    note: c.notes ? [
      {
        text: c.notes
      }
    ] : []
  };
};

// ==========================================
// FHIR REST API ENDPOINTS
// ==========================================

// 1. Get Patient list in FHIR Bundle format
router.get('/Patient', authenticateToken, async (req, res) => {
  try {
    const [patients] = await db.query('SELECT * FROM patients');
    const fhirEntries = patients.map(p => {
      const fhirPat = mapToFHIRPatient(p);
      return {
        fullUrl: `${req.protocol}://${req.get('host')}/api/fhir/Patient/${p.fhir_id}`,
        resource: fhirPat
      };
    });

    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: patients.length,
      entry: fhirEntries
    };

    res.json(bundle);
  } catch (error) {
    console.error('FHIR Patient bundle error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

// 2. Get specific Patient as FHIR Patient Resource
router.get('/Patient/:fhirId', authenticateToken, async (req, res) => {
  const fhirId = req.params.fhirId;
  try {
    const [patients] = await db.query('SELECT * FROM patients WHERE fhir_id = ?', [fhirId]);
    if (patients.length === 0) {
      return res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: `Patient with fhirId '${fhirId}' not found.` }]
      });
    }

    res.json(mapToFHIRPatient(patients[0]));
  } catch (error) {
    console.error('FHIR Patient error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

// 3. Get Observations (Lab Results) as FHIR Bundle
router.get('/Observation', authenticateToken, async (req, res) => {
  const { patient } = req.query; // Expecting patient FHIR ID (e.g. pat-alice-johnson)
  try {
    let query = `
      SELECT lr.*, p.fhir_id as patient_fhir_id 
      FROM lab_results lr 
      JOIN patients p ON lr.patient_id = p.id
    `;
    let params = [];

    if (patient) {
      // patient reference filter, e.g. "Patient/pat-alice-johnson" or "pat-alice-johnson"
      const cleanId = patient.replace('Patient/', '');
      query += ' WHERE p.fhir_id = ?';
      params.push(cleanId);
    }

    const [results] = await db.query(query, params);
    const fhirEntries = results.map(lr => {
      const fhirObs = mapToFHIRObservation(lr, lr.patient_fhir_id);
      return {
        fullUrl: `${req.protocol}://${req.get('host')}/api/fhir/Observation/${fhirObs.id}`,
        resource: fhirObs,
        search: { mode: 'match' }
      };
    });

    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: results.length,
      link: [{ relation: 'self', url: `${req.protocol}://${req.get('host')}${req.originalUrl}` }],
      entry: fhirEntries
    };

    res.json(bundle);
  } catch (error) {
    console.error('FHIR Observation error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

// 4. Get MedicationRequests (Prescriptions) as FHIR Bundle
router.get('/MedicationRequest', authenticateToken, async (req, res) => {
  const { patient } = req.query;
  try {
    let query = `
      SELECT pr.*, p.fhir_id as patient_fhir_id, d.first_name as doctor_first, d.last_name as doctor_last
      FROM prescriptions pr
      JOIN patients p ON pr.patient_id = p.id
      JOIN doctors d ON pr.doctor_id = d.id
    `;
    let params = [];

    if (patient) {
      const cleanId = patient.replace('Patient/', '');
      query += ' WHERE p.fhir_id = ?';
      params.push(cleanId);
    }

    const [prescriptions] = await db.query(query, params);
    const fhirEntries = prescriptions.map(pr => {
      const fhirMed = mapToFHIRMedicationRequest(pr, pr.patient_fhir_id);
      return {
        fullUrl: `${req.protocol}://${req.get('host')}/api/fhir/MedicationRequest/${fhirMed.id}`,
        resource: fhirMed,
        search: { mode: 'match' }
      };
    });

    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: prescriptions.length,
      link: [{ relation: 'self', url: `${req.protocol}://${req.get('host')}${req.originalUrl}` }],
      entry: fhirEntries
    };

    res.json(bundle);
  } catch (error) {
    console.error('FHIR MedicationRequest error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

// 5. Get Conditions (Medical History) as FHIR Bundle
router.get('/Condition', authenticateToken, async (req, res) => {
  const { patient } = req.query;
  try {
    let query = `
      SELECT mh.*, p.fhir_id as patient_fhir_id 
      FROM medical_histories mh
      JOIN patients p ON mh.patient_id = p.id
    `;
    let params = [];

    if (patient) {
      const cleanId = patient.replace('Patient/', '');
      query += ' WHERE p.fhir_id = ?';
      params.push(cleanId);
    }
    const [conditions] = await db.query(query, params);
    const fhirEntries = conditions.map(c => {
      const fhirCond = mapToFHIRCondition(c, c.patient_fhir_id);
      return {
        fullUrl: `${req.protocol}://${req.get('host')}/api/fhir/Condition/${fhirCond.id}`,
        resource: fhirCond,
        search: { mode: 'match' }
      };
    });

    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: conditions.length,
      link: [{ relation: 'self', url: `${req.protocol}://${req.get('host')}${req.originalUrl}` }],
      entry: fhirEntries
    };

    res.json(bundle);
  } catch (error) {
    console.error('FHIR Condition error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

// 6. Create Patient via incoming FHIR Patient JSON Payload
router.post('/Patient', authenticateToken, async (req, res) => {
  const fhirPayload = req.body;

  if (!fhirPayload || fhirPayload.resourceType !== 'Patient') {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid FHIR payload. resourceType must be Patient.' }]
    });
  }

  try {
    // Extract demographics from FHIR structure
    const fhirId = fhirPayload.id || `pat-fhir-${Date.now().toString().slice(-4)}`;
    
    const nameObj = fhirPayload.name && fhirPayload.name[0] ? fhirPayload.name[0] : {};
    const firstName = nameObj.given && nameObj.given[0] ? nameObj.given[0] : 'Unknown';
    const lastName = nameObj.family ? nameObj.family : 'FHIRPatient';
    
    const birthDate = fhirPayload.birthDate || new Date().toISOString().slice(0, 10);
    
    const fhirGender = fhirPayload.gender || 'unknown';
    // Map FHIR gender to DB gender (capitalize first letter)
    const gender = fhirGender.charAt(0).toUpperCase() + fhirGender.slice(1);
    
    const telecomObj = fhirPayload.telecom && fhirPayload.telecom[0] ? fhirPayload.telecom[0] : {};
    const phone = telecomObj.value || null;
    
    const addressObj = fhirPayload.address && fhirPayload.address[0] ? fhirPayload.address[0] : {};
    const address = addressObj.text || null;

    // Check if fhir_id already exists in our system
    const [existing] = await db.query('SELECT id FROM patients WHERE fhir_id = ?', [fhirId]);
    if (existing.length > 0) {
      // Overwrite/Update patient details
      await db.query(
        'UPDATE patients SET first_name = ?, last_name = ?, birth_date = ?, gender = ?, phone = ?, address = ? WHERE fhir_id = ?',
        [firstName, lastName, birthDate, gender, phone, address, fhirId]
      );
      
      return res.json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'information', code: 'informational', diagnostics: `Patient ${fhirId} updated successfully via FHIR sync.` }]
      });
    }

    // Insert new patient (not linked to an active user account yet, created via import)
    const [result] = await db.query(
      'INSERT INTO patients (first_name, last_name, birth_date, gender, phone, address, fhir_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [firstName, lastName, birthDate, gender, phone, address, fhirId]
    );

    res.status(201).json({
      resourceType: 'Patient',
      id: fhirId,
      active: true,
      name: [{ use: 'official', family: lastName, given: [firstName] }],
      gender: fhirGender,
      birthDate,
      meta: {
        versionId: '1',
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Import FHIR Patient error:', error);
    res.status(500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }] });
  }
});

module.exports = router;
