import React, { useState, useEffect } from 'react';
import { 
  Search, UserPlus, FileText, Pill, Activity, User, Calendar, 
  MapPin, Phone, Code, ArrowRight, CheckCircle, AlertCircle, Database, RefreshCw
} from 'lucide-react';

export default function DoctorDashboard({ user, onLogout }) {
  const token = localStorage.getItem('token');
  const [patients, setPatients] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  
  // Dashboard Sub-navigation
  const [dashboardTab, setDashboardTab] = useState('patients'); // 'patients', 'appointments', 'interop'

  // Patient Detailed Clinical Sub-Records
  const [patientHistory, setPatientHistory] = useState([]);
  const [patientLabs, setPatientLabs] = useState([]);
  const [patientRx, setPatientRx] = useState([]);
  const [patientAppointments, setPatientAppointments] = useState([]);
  const [patientFhir, setPatientFhir] = useState(null);

  // Forms states
  const [showAddCondition, setShowAddCondition] = useState(false);
  const [conditionForm, setConditionForm] = useState({ conditionName: '', onsetDate: '', status: 'active', notes: '' });

  const [showAddRx, setShowAddRx] = useState(false);
  const [rxForm, setRxForm] = useState({ medicationName: '', dosage: '', frequency: '', startDate: '', instructions: '' });

  const [showAddLab, setShowAddLab] = useState(false);
  const [labForm, setLabForm] = useState({ testName: '', testDate: '' });

  const [showFillLab, setShowFillLab] = useState(null); // stores lab record object to fill
  const [fillLabForm, setFillLabForm] = useState({ resultValue: '', resultUnit: '', referenceRange: '', status: 'completed' });

  // Appointment states
  const [appointmentsList, setAppointmentsList] = useState([]);

  // Interoperability / External System Search States
  const [extSearchName, setExtSearchName] = useState('');
  const [extSearchHospital, setExtSearchHospital] = useState('');
  const [extResults, setExtResults] = useState([]);
  const [importStatus, setImportStatus] = useState({ text: '', type: '' });

  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });

  // 1. Fetch Local Patients
  const fetchPatients = async (query = '') => {
    try {
      const response = await fetch(`http://localhost:5000/api/patients?search=${query}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setPatients(data);
    } catch (err) {
      console.error('Error fetching patients:', err);
    }
  };

  // 2. Fetch All Appointments (for Doctor)
  const fetchAppointments = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/clinical/appointments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setAppointmentsList(data);
    } catch (err) {
      console.error('Error fetching appointments:', err);
    }
  };

  useEffect(() => {
    fetchPatients();
    fetchAppointments();
  }, []);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    fetchPatients(e.target.value);
  };

  // 3. Fetch Selected Patient Details
  const handleSelectPatient = async (patient) => {
    setSelectedPatient(patient);
    setStatusMsg({ text: '', type: '' });
    
    // Reset form states
    setShowAddCondition(false);
    setShowAddRx(false);
    setShowAddLab(false);
    setShowFillLab(null);

    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      // Fetch Medical History
      const histRes = await fetch(`http://localhost:5000/api/clinical/medical-history/${patient.id}`, { headers });
      const histData = await histRes.json();
      setPatientHistory(histData);

      // Fetch Lab Results
      const labsRes = await fetch(`http://localhost:5000/api/clinical/lab-results/${patient.id}`, { headers });
      const labsData = await labsRes.json();
      setPatientLabs(labsData);

      // Fetch Prescriptions
      const rxRes = await fetch(`http://localhost:5000/api/clinical/prescriptions/${patient.id}`, { headers });
      const rxData = await rxRes.json();
      setPatientRx(rxData);

      // Fetch Patient's individual appointments
      const apptsRes = await fetch(`http://localhost:5000/api/clinical/appointments`, { headers });
      const apptsData = await apptsRes.json();
      setPatientAppointments(apptsData.filter(a => String(a.patient_id) === String(patient.id)));

      // Fetch FHIR representation
      const fhirRes = await fetch(`http://localhost:5000/api/fhir/Patient/${patient.fhir_id}`, { headers });
      const fhirData = await fhirRes.json();
      setPatientFhir(fhirData);

    } catch (err) {
      console.error('Error loading patient detailed records:', err);
    }
  };

  // 4. Forms Submit Handlers
  const handleAddCondition = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5000/api/clinical/medical-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          ...conditionForm
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      setStatusMsg({ text: 'Condition added successfully!', type: 'success' });
      setShowAddCondition(false);
      setConditionForm({ conditionName: '', onsetDate: '', status: 'active', notes: '' });
      
      // Refresh patient details
      handleSelectPatient(selectedPatient);
    } catch (err) {
      setStatusMsg({ text: err.message, type: 'danger' });
    }
  };

  const handleAddRx = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5000/api/clinical/prescriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          ...rxForm
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      setStatusMsg({ text: 'Prescription issued successfully!', type: 'success' });
      setShowAddRx(false);
      setRxForm({ medicationName: '', dosage: '', frequency: '', startDate: '', instructions: '' });

      handleSelectPatient(selectedPatient);
    } catch (err) {
      setStatusMsg({ text: err.message, type: 'danger' });
    }
  };

  const handleAddLabRequest = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://localhost:5000/api/clinical/lab-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          ...labForm
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      setStatusMsg({ text: 'Lab request submitted!', type: 'success' });
      setShowAddLab(false);
      setLabForm({ testName: '', testDate: '' });

      handleSelectPatient(selectedPatient);
    } catch (err) {
      setStatusMsg({ text: err.message, type: 'danger' });
    }
  };

  const handleFillLabResult = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`http://localhost:5000/api/clinical/lab-results/${showFillLab.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(fillLabForm)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      setStatusMsg({ text: 'Lab results inputted successfully!', type: 'success' });
      setShowFillLab(null);
      setFillLabForm({ resultValue: '', resultUnit: '', referenceRange: '', status: 'completed' });

      handleSelectPatient(selectedPatient);
    } catch (err) {
      setStatusMsg({ text: err.message, type: 'danger' });
    }
  };

  const handleUpdateApptStatus = async (apptId, newStatus) => {
    try {
      const response = await fetch(`http://localhost:5000/api/clinical/appointments/${apptId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) throw new Error('Failed to update status.');
      fetchAppointments();
      if (selectedPatient) handleSelectPatient(selectedPatient);
    } catch (err) {
      alert(err.message);
    }
  };

  // 5. Interoperability sync handlers
  const handleExternalSearch = async (e) => {
    e.preventDefault();
    setImportStatus({ text: '', type: '' });
    try {
      const response = await fetch(
        `http://localhost:5000/api/interop/external-search?name=${encodeURIComponent(extSearchName)}&hospital=${encodeURIComponent(extSearchHospital)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await response.json();
      if (!response.ok) {
        setExtResults([]);
        setImportStatus({ text: data.message || `External search failed (${response.status}).`, type: 'danger' });
        return;
      }
      setExtResults(Array.isArray(data) ? data : []);
      if (!Array.isArray(data) || data.length === 0) {
        setImportStatus({ text: 'No external records matched search filters.', type: 'danger' });
      }
    } catch (err) {
      setExtResults([]);
      setImportStatus({ text: 'Failed to reach the MediLink server.', type: 'danger' });
    }
  };

  const handleImportPatient = async (externalPat) => {
    setImportStatus({ text: `Syncing external record: ${externalPat.id}...`, type: 'info' });
    try {
      const response = await fetch('http://localhost:5000/api/interop/external-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fhirPatient: externalPat })
      });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message);

  const { imported = {}, warnings = [] } = data;
  setImportStatus({
    text: `${data.message} Conditions ${imported.conditions ?? 0}, lab results ${imported.observations ?? 0}, prescriptions ${imported.medications ?? 0}.`
              + (warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''),
    type: warnings.length ? 'info' : 'success'
  });
      
      // Clear results and reload local lists
      setExtResults([]);
      setExtSearchName('');
      fetchPatients();
    } catch (err) {
      setImportStatus({ text: err.message, type: 'danger' });
    }
  };

  return (
    <div className="dashboard-grid fade-in">
      {/* Sidebar navigation */}
      <div className="sidebar">
        <div className="sidebar-menu">
          <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '16px', paddingLeft: '16px' }}>
            Clinician Dashboard
          </h3>
          <button 
            className={`sidebar-link ${dashboardTab === 'patients' ? 'active' : ''}`}
            onClick={() => { setDashboardTab('patients'); setSelectedPatient(null); }}
          >
            <User size={18} />
            Patient Records
          </button>
          <button 
            className={`sidebar-link ${dashboardTab === 'appointments' ? 'active' : ''}`}
            onClick={() => { setDashboardTab('appointments'); setSelectedPatient(null); }}
          >
            <Calendar size={18} />
            Visits & Schedule
          </button>
          <button 
            className={`sidebar-link ${dashboardTab === 'interop' ? 'active' : ''}`}
            onClick={() => { setDashboardTab('interop'); setSelectedPatient(null); }}
          >
            <RefreshCw size={18} />
            FHIR Interop Console
          </button>
        </div>

        <button className="btn btn-outline" style={{ width: '100%' }} onClick={onLogout}>
          Sign Out
        </button>
      </div>

      {/* Main dashboard content */}
      <div className="main-content">
        
        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800' }}>Welcome, {user.name}</h1>
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Role: Doctor | Specialty: {user.specialty}</span>
          </div>
          <span className="badge badge-success" style={{ padding: '8px 16px' }}>Database Online</span>
        </div>

        {/* 1. PATIENTS WORKSPACE */}
        {dashboardTab === 'patients' && !selectedPatient && (
          <div className="fade-in">
            {/* Search Bar */}
            <div className="card" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1' }}>
                <Search size={18} style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-control"
                  style={{ paddingLeft: '48px' }}
                  placeholder="Search patient name, gender, or FHIR Identifier..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>
            </div>

            {/* Patients List Table */}
            <div className="card">
              <h3 style={{ marginBottom: '20px' }}>Patient Directories</h3>
              {patients.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No patients found.</p>
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Patient Name</th>
                        <th>Birth Date</th>
                        <th>Gender</th>
                        <th>Phone</th>
                        <th>FHIR ID</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patients.map(p => (
                        <tr key={p.id}>
                          <td><strong>{p.first_name} {p.last_name}</strong></td>
                          <td>{new Date(p.birth_date).toLocaleDateString()}</td>
                          <td>{p.gender}</td>
                          <td>{p.phone || 'N/A'}</td>
                          <td><code>{p.fhir_id}</code></td>
                          <td style={{ textAlign: 'right' }}>
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '8px 16px', fontSize: '12px' }}
                              onClick={() => handleSelectPatient(p)}
                            >
                              Open EHR
                              <ArrowRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 1b. PATIENT EHR DETAILED WORKSPACE */}
        {dashboardTab === 'patients' && selectedPatient && (
          <div className="fade-in">
            {/* Back to list */}
            <button 
              className="btn btn-secondary" 
              style={{ marginBottom: '20px' }}
              onClick={() => setSelectedPatient(null)}
            >
              Back to Patient Directory
            </button>

            {/* Status alerts */}
            {statusMsg.text && (
              <div className={`alert alert-${statusMsg.type}`}>
                {statusMsg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                <span>{statusMsg.text}</span>
              </div>
            )}

            {/* Demographics Card */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
              <div>
                <span className="badge badge-info" style={{ marginBottom: '8px' }}>Active EHR Profile</span>
                <h2 style={{ fontSize: '24px', fontWeight: '800' }}>{selectedPatient.first_name} {selectedPatient.last_name}</h2>
                <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)', fontSize: '13px', marginTop: '6px' }}>
                  <span>DOB: {new Date(selectedPatient.birth_date).toLocaleDateString()}</span>
                  <span>Gender: {selectedPatient.gender}</span>
                  <span>Phone: {selectedPatient.phone || 'N/A'}</span>
                  <span>Address: {selectedPatient.address || 'N/A'}</span>
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', display: 'block', color: 'var(--text-muted)', fontWeight: 'bold' }}>FHIR PATIENT REFERENCE</span>
                <code style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 'bold', backgroundColor: 'rgba(0,163,166,0.1)', padding: '4px 8px', borderRadius: '6px' }}>
                  Patient/{selectedPatient.fhir_id}
                </code>
              </div>
            </div>

            {/* Main Clinical Grid */}
            <div className="grid-2">
              
              {/* Medical History */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3>Medical Conditions</h3>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setShowAddCondition(!showAddCondition)}>
                    <UserPlus size={14} /> Add
                  </button>
                </div>

                {showAddCondition && (
                  <form onSubmit={handleAddCondition} style={{ marginBottom: '20px', padding: '16px', background: 'rgba(0,163,166,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="conditionName-input">Condition Name</label>
                      <input
                        id="conditionName-input"
                        type="text"
                        className="form-control"
                        placeholder="e.g. Asthma, Hyperlipidemia"
                        value={conditionForm.conditionName}
                        onChange={(e) => setConditionForm({...conditionForm, conditionName: e.target.value})}
                        required
                      />
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="onsetDate-input">Onset Date</label>
                        <input
                          id="onsetDate-input"
                          type="date"
                          className="form-control"
                          value={conditionForm.onsetDate}
                          onChange={(e) => setConditionForm({...conditionForm, onsetDate: e.target.value})}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="status-select">Status</label>
                        <select
                          id="status-select"
                          className="form-control"
                          value={conditionForm.status}
                          onChange={(e) => setConditionForm({...conditionForm, status: e.target.value})}
                        >
                          <option value="active">Active</option>
                          <option value="resolved">Resolved</option>
                          <option value="remission">Remission</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="notes-input">Clinical Notes</label>
                      <input
                        id="notes-input"
                        type="text"
                        className="form-control"
                        placeholder="Additional diagnostics info..."
                        value={conditionForm.notes}
                        onChange={(e) => setConditionForm({...conditionForm, notes: e.target.value})}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '10px' }}>Log Condition</button>
                  </form>
                )}

                {patientHistory.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No medical history conditions recorded.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {patientHistory.map(cond => (
                      <div key={cond.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '8px' }}>
                        <div>
                          <strong>{cond.condition_name}</strong>
                          <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>Onset: {new Date(cond.onset_date).toLocaleDateString()}</span>
                          {cond.notes && <span style={{ display: 'block', fontSize: '12px', fontStyle: 'italic', color: 'var(--text-muted)' }}>Note: {cond.notes}</span>}
                        </div>
                        <span className={`badge badge-${cond.status === 'active' ? 'success' : 'info'}`}>{cond.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prescriptions */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3>Medications</h3>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setShowAddRx(!showAddRx)}>
                    <Pill size={14} /> Prescribe
                  </button>
                </div>

                {showAddRx && (
                  <form onSubmit={handleAddRx} style={{ marginBottom: '20px', padding: '16px', background: 'rgba(0,163,166,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="medicationName-input">Medication Name</label>
                      <input
                        id="medicationName-input"
                        type="text"
                        className="form-control"
                        placeholder="e.g. Amoxicillin 500mg"
                        value={rxForm.medicationName}
                        onChange={(e) => setRxForm({...rxForm, medicationName: e.target.value})}
                        required
                      />
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="dosage-input">Dosage</label>
                        <input
                          id="dosage-input"
                          type="text"
                          className="form-control"
                          placeholder="1 tablet"
                          value={rxForm.dosage}
                          onChange={(e) => setRxForm({...rxForm, dosage: e.target.value})}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="frequency-input">Frequency</label>
                        <input
                          id="frequency-input"
                          type="text"
                          className="form-control"
                          placeholder="Three times daily"
                          value={rxForm.frequency}
                          onChange={(e) => setRxForm({...rxForm, frequency: e.target.value})}
                          required
                        />
                      </div>
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="startDate-input">Start Date</label>
                        <input
                          id="startDate-input"
                          type="date"
                          className="form-control"
                          value={rxForm.startDate}
                          onChange={(e) => setRxForm({...rxForm, startDate: e.target.value})}
                          required
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="rx-instructions-input">Directions / Instructions</label>
                      <input
                        id="rx-instructions-input"
                        type="text"
                        className="form-control"
                        placeholder="Take with meals, finish full course..."
                        value={rxForm.instructions}
                        onChange={(e) => setRxForm({...rxForm, instructions: e.target.value})}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '10px' }}>Issue Digital Rx</button>
                  </form>
                )}

                {patientRx.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No active prescriptions.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {patientRx.map(rx => (
                      <div key={rx.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '8px' }}>
                        <strong style={{ color: 'var(--primary)' }}>{rx.medication_name}</strong>
                        <span style={{ display: 'block', fontSize: '13px' }}>{rx.dosage} - {rx.frequency}</span>
                        {rx.instructions && <span style={{ display: 'block', fontSize: '12px', fontStyle: 'italic', color: 'var(--text-muted)' }}>Dir: {rx.instructions}</span>}
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Start: {new Date(rx.start_date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Labs Workspace */}
            <div className="card" style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3>Laboratory Requests & Findings</h3>
                <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setShowAddLab(!showAddLab)}>
                  <FileText size={14} /> Request New Lab
                </button>
              </div>

              {showAddLab && (
                <form onSubmit={handleAddLabRequest} style={{ marginBottom: '20px', padding: '16px', background: 'rgba(0,163,166,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', maxWidth: '400px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="testName-input">Lab Test Name</label>
                    <input
                      id="testName-input"
                      type="text"
                      className="form-control"
                      placeholder="e.g. Lipid Profile, Complete Blood Count"
                      value={labForm.testName}
                      onChange={(e) => setLabForm({...labForm, testName: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="testDate-input">Date for Test</label>
                    <input
                      id="testDate-input"
                      type="date"
                      className="form-control"
                      value={labForm.testDate}
                      onChange={(e) => setLabForm({...labForm, testDate: e.target.value})}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '10px' }}>Issue Lab Request</button>
                </form>
              )}

              {/* Fill Lab Result Modal-like Inline Form */}
              {showFillLab && (
                <form onSubmit={handleFillLabResult} style={{ marginBottom: '20px', padding: '20px', background: 'var(--secondary)', borderRadius: '16px', border: '1.5px solid var(--primary)', maxWidth: '500px' }}>
                  <h4 style={{ marginBottom: '14px', color: 'var(--primary)' }}>Input Result: {showFillLab.test_name}</h4>
                  <div className="grid-3">
                    <div className="form-group">
                      <label className="form-label" htmlFor="resultValue-input">Result Value</label>
                      <input
                        id="resultValue-input"
                        type="text"
                        className="form-control"
                        placeholder="e.g. 5.8, Normal"
                        value={fillLabForm.resultValue}
                        onChange={(e) => setFillLabForm({...fillLabForm, resultValue: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="resultUnit-input">Unit</label>
                      <input
                        id="resultUnit-input"
                        type="text"
                        className="form-control"
                        placeholder="mg/dL, g/dL, %"
                        value={fillLabForm.resultUnit}
                        onChange={(e) => setFillLabForm({...fillLabForm, resultUnit: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="referenceRange-input">Ref Range</label>
                      <input
                        id="referenceRange-input"
                        type="text"
                        className="form-control"
                        placeholder="< 5.6"
                        value={fillLabForm.referenceRange}
                        onChange={(e) => setFillLabForm({...fillLabForm, referenceRange: e.target.value})}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px' }}>Save Findings</button>
                    <button type="button" className="btn btn-outline" style={{ padding: '8px 16px' }} onClick={() => setShowFillLab(null)}>Cancel</button>
                  </div>
                </form>
              )}

              {patientLabs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No lab requests found.</p>
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Test Name</th>
                        <th>Requested Date</th>
                        <th>Findings</th>
                        <th>Unit</th>
                        <th>Reference Range</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientLabs.map(lab => (
                        <tr key={lab.id}>
                          <td><strong>{lab.test_name}</strong></td>
                          <td>{new Date(lab.test_date).toLocaleDateString()}</td>
                          <td>{lab.result_value}</td>
                          <td>{lab.result_unit}</td>
                          <td><code>{lab.reference_range}</code></td>
                          <td>
                            <span className={`badge badge-${lab.status === 'completed' ? 'success' : lab.status === 'pending' ? 'warning' : 'danger'}`}>
                              {lab.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {lab.status !== 'completed' && (
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '11px' }}
                                onClick={() => { setShowFillLab(lab); setFillLabForm({ resultValue: '', resultUnit: '', referenceRange: '', status: 'completed' }); }}
                              >
                                Enter Result
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* FHIR Live Export */}
            <div className="card" style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3>FHIR JSON Payload</h3>
                <span className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={14} /> HL7 compliant</span>
              </div>
              {patientFhir ? (
                <pre className="fhir-console">{JSON.stringify(patientFhir, null, 2)}</pre>
              ) : (
                <p>Generating FHIR JSON representation...</p>
              )}
            </div>
          </div>
        )}

        {/* 2. VISITS & SCHEDULES VIEW */}
        {dashboardTab === 'appointments' && (
          <div className="card fade-in">
            <h3 style={{ marginBottom: '20px' }}>Your Appointments Timeline</h3>
            {appointmentsList.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No scheduled appointments.</p>
            ) : (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Clinic Time</th>
                      <th>Visit Reason</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointmentsList.map(appt => (
                      <tr key={appt.id}>
                        <td><strong>{appt.patient_first} {appt.patient_last}</strong></td>
                        <td>
                          {new Date(appt.appointment_date).toLocaleDateString()} at {new Date(appt.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>{appt.reason || 'N/A'}</td>
                        <td>
                          <span className={`badge badge-${appt.status === 'scheduled' ? 'warning' : appt.status === 'completed' ? 'success' : 'danger'}`}>
                            {appt.status}
                          </span>
                        </td>
                        <td>
                          {appt.status === 'scheduled' && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '11px' }}
                                onClick={() => handleUpdateApptStatus(appt.id, 'completed')}
                              >
                                Check In / Done
                              </button>
                              <button 
                                className="btn btn-outline" 
                                style={{ padding: '6px 12px', fontSize: '11px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                                onClick={() => handleUpdateApptStatus(appt.id, 'cancelled')}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. INTEROPERABILITY / EXTERNAL SYNC VIEW */}
        {dashboardTab === 'interop' && (
          <div className="fade-in">
            <div className="card" style={{ background: 'linear-gradient(135deg, var(--white) 60%, var(--secondary) 100%)' }}>
              <h2>Hospital Interoperability Layer (HL7 FHIR Network)</h2>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px', maxWidth: '800px' }}>
                Connecting your health information system to external hospital hubs. You can search external directories (such as Riverside General Hospital) for a patient record, retrieve their profile in FHIR JSON format, and pull/import it into your local MySQL system along with all linked conditions, prescriptions, and lab history.
              </p>
            </div>

            {importStatus.text && (
              <div className={`alert alert-${importStatus.type}`}>
                {importStatus.type === 'success' ? <CheckCircle size={18} /> : importStatus.type === 'info' ? <RefreshCw className="logo-icon" size={18} /> : <AlertCircle size={18} />}
                <span>{importStatus.text}</span>
              </div>
            )}

            <div className="grid-2" style={{ alignItems: 'start' }}>
              {/* Search External System */}
              <div className="card">
                <h3 style={{ marginBottom: '16px' }}>Query External Hospital Repositories</h3>
                <form onSubmit={handleExternalSearch}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="extSearchName-input">Patient Name</label>
                    <input
                      id="extSearchName-input"
                      type="text"
                      className="form-control"
                      placeholder="e.g. Sarah Connor, Bruce Wayne"
                      value={extSearchName}
                      onChange={(e) => setExtSearchName(e.target.value)}
                    />
                  </div>
                  
                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label className="form-label" htmlFor="extSearchHospital-select">Hospital System</label>
                    <select
                      id="extSearchHospital-select"
                      className="form-control"
                      value={extSearchHospital}
                      onChange={(e) => setExtSearchHospital(e.target.value)}
                    >
                      <option value="">All Connected Hubs</option>
                      <option value="Riverside General Hospital">Riverside General Hospital</option>
                    </select>
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                    <Search size={16} /> Search Hospital Network
                  </button>
                </form>
              </div>

              {/* Search Results */}
              <div className="card">
                <h3 style={{ marginBottom: '16px' }}>Network Search Results</h3>
                {extResults.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>Search the network to view external FHIR profiles.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {extResults.map(p => (
                      <div key={p.id} className="card-hover" style={{ padding: '16px', borderRadius: '12px', border: '1.5px solid var(--border-color)', backgroundColor: 'var(--white)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <strong style={{ fontSize: '16px' }}>{p.name[0].given[0]} {p.name[0].family}</strong>
                          <span className="badge badge-info">{p.hospitalSource}</span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                          <span>DOB: {p.birthDate} ({p.gender})</span><br/>
                          <span>Address: {p.address[0].text}</span>
                        </div>
                        <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', alignItems: 'center' }}>
                          <code style={{ fontSize: '12px', color: 'var(--primary)' }}>FHIR ID: {p.id}</code>
                          <button 
                            className="btn btn-primary" 
                            style={{ padding: '8px 16px', fontSize: '12px' }}
                            onClick={() => handleImportPatient(p)}
                          >
                            <RefreshCw size={12} /> Sync & Import Records
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
