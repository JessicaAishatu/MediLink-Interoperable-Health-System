# FHIR import mapping

How resources fetched from the external FHIR server are mapped into MediLink's tables by `backend/routes/interop.js`. The server re-fetches the Patient and its Condition, Observation and MedicationRequest Bundles from the source on every import; the browser only names the patient.

Source: configured by `EXTERNAL_FHIR_BASE` and `EXTERNAL_HOSPITAL_NAME` in `.env`. Demo source: `external-hospital/` (Riverside General Hospital), a standalone FHIR R4 server with its own identifier system.

## Patient → patients
| FHIR path | MediLink column | Notes |
| --- | --- | --- |
| id | fhir_id | the source id is kept as MediLink's FHIR id; matches on re-import |
| identifier[0].system\|value | — | stored in each imported record's notes as provenance |
| name[0].given[0] / name[0].family | first_name / last_name | defaults "Unknown" / "Imported" if absent |
| gender | gender | capitalised (female → Female) |
| birthDate | birth_date | NULL with a warning if absent |
| telecom[0].value | phone | |
| address[0].text | address | |

## Condition → medical_histories
| FHIR path | MediLink column | Notes |
| --- | --- | --- |
| code.text, else code.coding[0].display | condition_name | skipped with a warning if neither present |
| clinicalStatus.coding[0].code | status | resolved/remission/inactive → resolved; anything else → active |
| onsetDateTime | onset_date | date part only |
| note[0].text + provenance + [system code] | notes | the SNOMED code is preserved in the note; MediLink has no code column |

## Observation → lab_results
| FHIR path | MediLink column | Notes |
| --- | --- | --- |
| code.text, else code.coding[0].display | test_name | |
| effectiveDateTime, else issued | test_date | skipped with a warning if neither present |
| valueQuantity.value / .unit | result_value / result_unit | else valueString; else valueCodeableConcept text; else "Pending" with a warning |
| referenceRange[0].text | reference_range | |
| status final/amended/corrected → completed; else → pending | status | |

## MedicationRequest → prescriptions
| FHIR path | MediLink column | Notes |
| --- | --- | --- |
| medicationCodeableConcept.text, else coding[0].display | medication_name | |
| dosageInstruction[0].text | dosage | |
| dosageInstruction[0].timing.repeat.frequency | frequency | 1 → Once daily, 2 → Twice daily, 3 → Three times daily, else the text |
| authoredOn | start_date | today with a warning if absent |
| patientInstruction or text + provenance | instructions | |
| — | doctor_id | the importing doctor; the source's requester is not kept (no Practitioner import) |

## Behaviour in the ugly cases
| Case | Behaviour |
| --- | --- |
| External server down | search and import return 502 with "External FHIR server unreachable"; UI shows the message |
| Patient id not on the source | import returns 404 OperationOutcome text |
| Non-FHIR response | 502 "returned non-FHIR content" |
| Unrecognised code system | record imported from text; warning listed in the response |
| Re-import of the same patient | profile updated; conditions, labs and prescriptions de-duplicated on name/date; warning listed |
| Any failure mid-import | transaction rolled back; nothing partially written |

## Known gaps
- Codes are not stored in dedicated columns, so an imported condition round-trips through MediLink's own FHIR API via the lookup table, not the original code.
- The source Practitioner is not imported; prescriptions are attributed to the importing doctor.
- One external source at a time; the hospital filter is a label, not a registry.