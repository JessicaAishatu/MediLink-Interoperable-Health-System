const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// MOCK EXTERNAL SYSTEM PATIENTS (FHIR Format)
const MOCK_EXTERNAL_PATIENTS = [
  {
    resourceType: 'Patient',
    id: 'ext-pat-sarah-connor',
    active: true,
    name: [{ use: 'official', family: 'Connor', given: ['Sarah'] }],
    gender: 'female',
    birthDate: '1985-05-12',
    telecom: [{ system: 'phone', value: '+1-555-9000', use: 'mobile' }],
    address: [{ text: '742 Evergreen Terrace, Springfield' }],
    hospitalSource: 'St. Jude General Hospital'
  },
  {
    resourceType: 'Patient',
    id: 'ext-pat-bruce-wayne',
    active: true,
    name: [{ use: 'official', family: 'Wayne', given: ['Bruce'] }],
    gender: 'male',
    birthDate: '1979-02-19',
    telecom: [{ system: 'phone', value: '+1-555-1939', use: 'mobile' }],
    address: [{ text: '1007 Mountain Drive, Gotham City' }],
    hospitalSource: 'Gotham City Clinic'
  }
];

// MOCK EXTERNAL CLINICAL RECORDS
const MOCK_EXTERNAL_CLINICAL_RECORDS = {
  'ext-pat-sarah-connor': {
    observations: [
      { test_name: 'Blood Pressure', test_date: '2026-06-10', result_value: '135/85', result_unit: 'mmHg', reference_range: '< 120/80', status: 'completed' },
      { test_name: 'Heart Rate', test_date: '2026-06-10', result_value: '72', result_unit: 'bpm', reference_range: '60 - 100', status: 'completed' }
    ],
    conditions: [
      { condition_name: 'Post-Traumatic Stress Disorder', onset_date: '2020-08-20', status: 'active', notes: 'Triggered by repetitive trauma. Undergoing therapy.' }
    ],
    prescriptions: [
      { medication_name: 'Sertraline 50mg', dosage: '1 tablet', frequency: 'Once daily', start_date: '2026-05-01', instructions: 'Take in the morning with food.' }
    ]
  },
  'ext-pat-bruce-wayne': {
    observations: [
      { test_name: 'Serum Iron', test_date: '2026-07-01', result_value: '95', result_unit: 'ug/dL', reference_range: '60 - 170', status: 'completed' },
      { test_name: 'Hemoglobin', test_date: '2026-07-01', result_value: '15.2', result_unit: 'g/dL', reference_range: '13.8 - 17.2', status: 'completed' }
    ],
    conditions: [
      { condition_name: 'Chronic Sleep Deprivation', onset_date: '2015-10-12', status: 'active', notes: 'Patient averages 3-4 hours of sleep per night.' },
      { condition_name: 'Multiple Rib Fractures', onset_date: '2025-12-25', status: 'resolved', notes: 'Healed normally.' }
    ],
    prescriptions: [
      { medication_name: 'Melatonin 5mg', dosage: '1 capsule', frequency: 'At bedtime as needed', start_date: '2026-01-10', instructions: 'Take 30 minutes before sleep.' }
    ]
  }
};

// 1. Search External Hospital Systems (Doctors only)
router.get('/external-search', authenticateToken, authorizeRoles('doctor', 'admin'), async (req, res) => {
  const { name, hospital } = req.query;
  try {
    let results = MOCK_EXTERNAL_PATIENTS;

    if (name) {
      const searchName = name.toLowerCase();
      results = results.filter(p => 
        p.name[0].family.toLowerCase().includes(searchName) || 
        p.name[0].given[0].toLowerCase().includes(searchName)
      );
    }

    if (hospital) {
      results = results.filter(p => p.hospitalSource === hospital);
    }

    res.json(results);

  } catch (error) {
    console.error('External search error:', error);
    res.status(500).json({ message: 'Error searching external hospital network.' });
  }
});

// 2. Import External FHIR Patient and clinical records (Doctors only)
router.post('/external-import', authenticateToken, authorizeRoles('doctor', 'admin'), async (req, res) => {
  const { fhirPatient } = req.body;

  if (!fhirPatient || fhirPatient.resourceType !== 'Patient') {
    return res.status(400).json({ message: 'Invalid payload. Expecting FHIR Patient.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const fhirId = fhirPatient.id;
    const nameObj = fhirPatient.name[0] || {};
    const firstName = nameObj.given[0] || 'Unknown';
    const lastName = nameObj.family || 'Imported';
    const birthDate = fhirPatient.birthDate || '1990-01-01';
    
    const fhirGender = fhirPatient.gender || 'unknown';
    const gender = fhirGender.charAt(0).toUpperCase() + fhirGender.slice(1);
    
    const telecomObj = fhirPatient.telecom ? fhirPatient.telecom[0] : {};
    const phone = telecomObj.value || null;
    
    const addressObj = fhirPatient.address ? fhirPatient.address[0] : {};
    const address = addressObj.text || null;

    // Check if patient already exists in local DB
    let localPatientId;
    const [existing] = await connection.query('SELECT id FROM patients WHERE fhir_id = ?', [fhirId]);
    
    if (existing.length > 0) {
      localPatientId = existing[0].id;
      // Update patient profile
      await connection.query(
        'UPDATE patients SET first_name = ?, last_name = ?, birth_date = ?, gender = ?, phone = ?, address = ? WHERE id = ?',
        [firstName, lastName, birthDate, gender, phone, address, localPatientId]
      );
    } else {
      // Insert new patient
      const [pRes] = await connection.query(
        'INSERT INTO patients (first_name, last_name, birth_date, gender, phone, address, fhir_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [firstName, lastName, birthDate, gender, phone, address, fhirId]
      );
      localPatientId = pRes.insertId;
    }

    // Now import clinical records if we have mock records for this patient
    const clinicalData = MOCK_EXTERNAL_CLINICAL_RECORDS[fhirId];
    if (clinicalData) {
      console.log(`Importing clinical data for external patient: ${fhirId}`);

      // Import Observations (Lab Results)
      for (const obs of clinicalData.observations) {
        // Prevent duplicate lab results
        const [existObs] = await connection.query(
          'SELECT id FROM lab_results WHERE patient_id = ? AND test_name = ? AND test_date = ?',
          [localPatientId, obs.test_name, obs.test_date]
        );
        if (existObs.length === 0) {
          await connection.query(
            'INSERT INTO lab_results (patient_id, test_name, test_date, result_value, result_unit, reference_range, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [localPatientId, obs.test_name, obs.test_date, obs.result_value, obs.result_unit, obs.reference_range, obs.status]
          );
        }
      }

      // Import Conditions (Medical History)
      for (const cond of clinicalData.conditions) {
        const [existCond] = await connection.query(
          'SELECT id FROM medical_histories WHERE patient_id = ? AND condition_name = ?',
          [localPatientId, cond.condition_name]
        );
        if (existCond.length === 0) {
          await connection.query(
            'INSERT INTO medical_histories (patient_id, condition_name, onset_date, status, notes) VALUES (?, ?, ?, ?, ?)',
            [localPatientId, cond.condition_name, cond.onset_date, cond.status, cond.notes]
          );
        }
      }

      // Import Prescriptions
      // For prescriptions, we'll map them to the importing doctor's ID
      let doctorId = 1; // Fallback to doctor with ID 1
      if (req.user.doctorId) {
        doctorId = req.user.doctorId;
      }
      for (const pr of clinicalData.prescriptions) {
        const [existPr] = await connection.query(
          'SELECT id FROM prescriptions WHERE patient_id = ? AND medication_name = ? AND start_date = ?',
          [localPatientId, pr.medication_name, pr.start_date]
        );
        if (existPr.length === 0) {
          await connection.query(
            'INSERT INTO prescriptions (patient_id, doctor_id, medication_name, dosage, frequency, start_date, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [localPatientId, doctorId, pr.medication_name, pr.dosage, pr.frequency, pr.start_date, pr.instructions]
          );
        }
      }
    }

    await connection.commit();
    res.json({ message: 'Patient and FHIR clinical records successfully imported into local system.', patientId: localPatientId });

  } catch (error) {
    await connection.rollback();
    console.error('Import error:', error);
    res.status(500).json({ message: 'Failed to import external health records.', error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
