# FHIR R4 conformance

Validated with the HL7 FHIR Validator (https://validator.fhir.org), FHIR R4 4.0.1, base specification, no profiles. Full validator output in `docs/fhir-samples/*.validation.txt`.

## Validation results

| Resource | Sample | Before fixes | After fixes |
| --- | --- | --- | --- |
| Patient | patient.json | 0 errors, 1 warning (dom-6, narrative recommended) | 0 errors, 1 warning (dom-6)|
| Observation (Bundle) | observation.json |3 errors (unknown LOINC code 1000-0, one per Observation); warnings: no performer on each Observation, dom-6 narrative, searchset Bundle lacks link[self] and entry.search.mode|0 errors; warnings: dom-6 ×3, trailing whitespace in one value (fixed by trimming)|
| Condition (Bundle) | condition.json | 2 errors (unknown SNOMED code 000000); warnings dom-6, Bundle self link, search mode.|0 errors; warnings: dom-6 ×3, trailing whitespace in one value (fixed by trimming) |
| MedicationRequest (Bundle) | medicationrequest.json |2 errors (unknown RxNorm code 000000); warnings dom-6, Bundle self link, search mode.| |
| CapabilityStatement | metadata.json | — (not yet implemented) | 0 errors; warnings: dom-6 ×3|

## Supported interactions

(filled in Step 4)

## Not supported

(filled in Step 4)