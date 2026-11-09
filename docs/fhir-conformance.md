# FHIR R4 conformance

Validated with the HL7 FHIR Validator (https://validator.fhir.org), FHIR R4 4.0.1, base specification, no profiles. Full validator output in `docs/fhir-samples/*.validation.txt`.

## Validation results

| Resource | Sample | Before fixes | After fixes |
| --- | --- | --- | --- |
| Patient | patient.json | 0 errors, 1 warning (dom-6, narrative recommended) | 0 errors, 1 warning (dom-6)|
| Observation (Bundle) | observation.json |3 errors (unknown LOINC code 1000-0, one per Observation); warnings: no performer on each Observation, dom-6 narrative, searchset Bundle lacks link[self] and entry.search.mode|0 errors; warnings: dom-6 ×3, trailing whitespace in one value (fixed by trimming)|
| Condition (Bundle) | condition.json | 2 errors (unknown SNOMED code 000000); warnings dom-6, Bundle self link, search mode.|0 errors; warnings: dom-6 ×3, trailing whitespace in one value (fixed by trimming) |
| MedicationRequest (Bundle) | medicationrequest.json |2 errors (unknown RxNorm code 000000); warnings dom-6, Bundle self link, search mode.| |
| CapabilityStatement | metadata.json | — (endpoint did not exist) | 0 errors, 1 warning (dom-6); first version had 2 errors (empty searchParam arrays), fixed |
| Practitioner | practitioner.json | — (endpoint did not exist) | 0 errors, 1 warning (dom-6) |

## Supported interactions

| Resource | Interactions | Search parameters | Source table → FHIR mapping |
| --- | --- | --- | --- |
| Patient | read | — | patients: fhir_id → id and identifier (system `http://medilink.example/mrn`); first_name/last_name → name; gender; birth_date → birthDate; phone → telecom; address → address.text |
| Practitioner | read | — | doctors: id → `doc-{id}`; first_name/last_name → name with prefix Dr.; phone → telecom; specialty → qualification.code.text |
| Observation | search-type | patient | lab_results: test_name → code (LOINC via lookup table, else text); result_value/result_unit → valueQuantity (UCUM) or valueString; test_date → effectiveDateTime; status completed → final, otherwise registered; reference_range → referenceRange.text; performer fixed to Organization/medilink |
| Condition | search-type | patient | medical_histories: condition_name → code (SNOMED via lookup table, else text); status → clinicalStatus active/resolved; onset_date → onsetDateTime; notes → note |
| MedicationRequest | search-type | patient | prescriptions: medication_name → medicationCodeableConcept (RxNorm via lookup table, else text); start_date → authoredOn; end_date in the past → status completed, else active; doctor → requester Practitioner/doc-{id}; dosage/frequency → dosageInstruction.text and timing |
| CapabilityStatement | read (`/metadata`, no auth) | — | generated |

Search Bundles are `searchset` type with a `self` link and `search.mode = match` on each entry. All resource endpoints except `/metadata` require a JWT.

## Not supported

- Per-resource read for Observation, Condition and MedicationRequest (`/Observation/{id}` etc.); Bundle `fullUrl`s point at these paths but they are not served.
- Search parameters other than `patient`; no `_count`, paging or `_include`.
- Create, update, delete, or `_history` through the FHIR API; writes happen through MediLink's own REST endpoints.
- Bundle `transaction` or `batch`; the import flow reads individual resources.
- SMART on FHIR / OAuth2; authentication is MediLink's JWT.
- Organization resource (referenced as `Organization/medilink` by Observation.performer but not served).
- Resource narrative (`text`); every resource carries the dom-6 best-practice warning.
- Terminology coverage is limited to the lookup tables in `routes/fhir.js`; any test, condition or drug not listed is emitted as `text` only.

## Rules learned

- FHIR forbids empty arrays; optional repeating elements are omitted when empty.
- Codes must exist in the named code system; the validator checks them against the live terminology server, so placeholders are errors, not warnings.
- Dates must be formatted from their own year, month and day; converting through UTC shifts them in any timezone east of Greenwich.
- A searchset Bundle should declare its `self` link and each entry's `search.mode`.
