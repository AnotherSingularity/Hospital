import { VisitTypeSchema, type Department, type Tenant, type VisitType } from '@cadence/domain';

/**
 * ============================================================================
 * ENTIRELY FICTIONAL CATALOG — SYNTHETIC TEST DATA
 * ============================================================================
 * "Meridian Valley Imaging" and "Northgate Orthopedic Partners" are invented
 * organizations. Every visit type, code, alias, department, capability, and
 * device flag below was written for this proof of concept.
 *
 * Nothing here is derived from, copied from, or informed by any real health
 * system's configuration, any employer materials, or any licensed code set
 * (CPT/HCPCS content is deliberately absent). See docs/data-governance.md.
 *
 * Two hygiene problems are modelled ON PURPOSE, because a resolver that cannot
 * detect them is not safe to deploy against a real catalog:
 *   - alias collisions across distinct visit types (drives `ambiguous`)
 *   - near-duplicate entries differing only by anatomy scope
 * ============================================================================
 */

export const TENANT_MERIDIAN: Tenant = { id: 'meridian-imaging', name: 'Meridian Valley Imaging' };
export const TENANT_NORTHGATE: Tenant = {
  id: 'northgate-ortho',
  name: 'Northgate Orthopedic Partners',
};

export const TENANTS: readonly Tenant[] = [TENANT_MERIDIAN, TENANT_NORTHGATE];

export const DEPARTMENTS: readonly Department[] = [
  {
    id: 'DEPT-MV-MAIN',
    tenantId: 'meridian-imaging',
    name: 'Meridian Main Imaging Center',
    capabilities: [
      'wide_bore_mr',
      'nuclear_medicine',
      'pediatric_sedation',
      'mammography',
      'ct',
      'us',
      'xr',
    ],
  },
  {
    id: 'DEPT-MV-ANNEX',
    tenantId: 'meridian-imaging',
    name: 'Northgate Annex (Outpatient)',
    capabilities: ['ct', 'us', 'xr'],
  },
  {
    id: 'DEPT-NG-CLINIC',
    tenantId: 'northgate-ortho',
    name: 'Northgate Clinic Radiology',
    capabilities: ['xr', 'us'],
  },
];

type Draft = Omit<
  VisitType,
  'tenantId' | 'active' | 'version' | 'ageBands' | 'requiredCapabilities' | 'aliases'
> &
  Partial<Pick<VisitType, 'ageBands' | 'requiredCapabilities' | 'aliases' | 'active'>>;

function vt(tenantId: string, d: Draft): VisitType {
  return VisitTypeSchema.parse({
    ...d,
    tenantId,
    active: d.active ?? true,
    version: 1,
    ageBands: d.ageBands ?? ['adult', 'geriatric'],
    requiredCapabilities: d.requiredCapabilities ?? [],
    aliases: d.aliases ?? [],
  });
}

const M = 'meridian-imaging';

export const MERIDIAN_CATALOG: readonly VisitType[] = [
  /* ---------------- MR ---------------- */
  vt(M, {
    id: 'VT-MR-LSPINE-WO',
    code: 'MR101',
    displayName: 'MR Lumbar Spine without Contrast',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'lumbar_spine',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri lumbar spine without contrast', 'mri l-spine wo', 'lumbar mri non-contrast'],
  }),
  vt(M, {
    id: 'VT-MR-LSPINE-W',
    code: 'MR102',
    displayName: 'MR Lumbar Spine with Contrast',
    durationMinutes: 45,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'lumbar_spine',
    contrast: 'with',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri lumbar spine with contrast', 'mri l-spine w'],
  }),
  vt(M, {
    id: 'VT-MR-LSPINE-WWO',
    code: 'MR103',
    displayName: 'MR Lumbar Spine with and without Contrast',
    durationMinutes: 60,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'lumbar_spine',
    contrast: 'with_and_without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri lumbar spine with and without'],
  }),
  vt(M, {
    id: 'VT-MR-CSPINE-WO',
    code: 'MR110',
    displayName: 'MR Cervical Spine without Contrast',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'cervical_spine',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri cervical spine', 'mri c-spine'],
  }),
  vt(M, {
    id: 'VT-MR-BRAIN-WO',
    code: 'MR120',
    displayName: 'MR Brain without Contrast',
    durationMinutes: 35,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'brain',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri brain', 'mri head without contrast'],
  }),
  vt(M, {
    id: 'VT-MR-BRAIN-WWO',
    code: 'MR121',
    displayName: 'MR Brain with and without Contrast',
    durationMinutes: 55,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'brain',
    contrast: 'with_and_without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri brain with and without contrast'],
  }),
  vt(M, {
    id: 'VT-MR-KNEE-WO',
    code: 'MR130',
    displayName: 'MR Knee without Contrast',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'knee',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri knee', 'knee mri'],
  }),
  vt(M, {
    id: 'VT-MR-SHOULDER-WO',
    code: 'MR140',
    displayName: 'MR Shoulder without Contrast',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'shoulder',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri shoulder', 'shoulder mri'],
  }),
  vt(M, {
    id: 'VT-MR-ABDOMEN-W',
    code: 'MR150',
    displayName: 'MR Abdomen with Contrast',
    durationMinutes: 50,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'abdomen',
    contrast: 'with',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri abdomen with contrast'],
  }),
  vt(M, {
    id: 'VT-MR-PELVIS-WO',
    code: 'MR160',
    displayName: 'MR Pelvis without Contrast',
    durationMinutes: 40,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'pelvis',
    contrast: 'without',
    requiredCapabilities: ['wide_bore_mr'],
    aliases: ['mri pelvis'],
  }),
  vt(M, {
    id: 'VT-MR-BRAIN-PEDS-WO',
    code: 'MR125',
    displayName: 'MR Brain Pediatric without Contrast',
    durationMinutes: 75,
    specialty: 'imaging',
    modality: 'MR',
    bodyRegion: 'brain',
    contrast: 'without',
    ageBands: ['pediatric'],
    requiredCapabilities: ['wide_bore_mr', 'pediatric_sedation'],
    aliases: ['pediatric mri brain', 'peds brain mri'],
  }),

  /* ---------------- CT ---------------- */
  vt(M, {
    id: 'VT-CT-HEAD-WO',
    code: 'CT201',
    displayName: 'CT Head without Contrast',
    durationMinutes: 15,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'brain',
    contrast: 'without',
    requiredCapabilities: ['ct'],
    aliases: ['ct head', 'ct brain without contrast', 'head ct non-contrast'],
  }),
  vt(M, {
    id: 'VT-CT-HEAD-W',
    code: 'CT202',
    displayName: 'CT Head with Contrast',
    durationMinutes: 25,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'brain',
    contrast: 'with',
    requiredCapabilities: ['ct'],
    aliases: ['ct head with contrast'],
  }),
  vt(M, {
    id: 'VT-CT-CHEST-WO',
    code: 'CT210',
    displayName: 'CT Chest without Contrast',
    durationMinutes: 15,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'chest',
    contrast: 'without',
    requiredCapabilities: ['ct'],
    aliases: ['ct chest', 'chest ct without contrast'],
  }),
  vt(M, {
    id: 'VT-CT-CHEST-W',
    code: 'CT211',
    displayName: 'CT Chest with Contrast',
    durationMinutes: 25,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'chest',
    contrast: 'with',
    requiredCapabilities: ['ct'],
    aliases: ['ct chest with contrast'],
  }),
  vt(M, {
    id: 'VT-CT-ABDOMEN-W',
    code: 'CT220',
    displayName: 'CT Abdomen with Contrast',
    durationMinutes: 25,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'abdomen',
    contrast: 'with',
    requiredCapabilities: ['ct'],
    // Deliberate collision with VT-CT-ABDPELVIS-W below.
    aliases: ['ct abdomen with contrast', 'abdominal ct with contrast'],
  }),
  vt(M, {
    id: 'VT-CT-ABDPELVIS-W',
    code: 'CT221',
    displayName: 'CT Abdomen and Pelvis with Contrast',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'abdomen',
    contrast: 'with',
    requiredCapabilities: ['ct'],
    // Deliberate collision: same alias appears on VT-CT-ABDOMEN-W.
    aliases: ['ct abdomen and pelvis with contrast', 'abdominal ct with contrast'],
  }),
  vt(M, {
    id: 'VT-CT-CSPINE-WO',
    code: 'CT230',
    displayName: 'CT Cervical Spine without Contrast',
    durationMinutes: 15,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'cervical_spine',
    contrast: 'without',
    requiredCapabilities: ['ct'],
    aliases: ['ct c-spine', 'ct cervical spine'],
  }),
  vt(M, {
    id: 'VT-CT-ANGIO-CHEST-W',
    code: 'CT240',
    displayName: 'CT Angiography Chest with Contrast',
    durationMinutes: 35,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'chest',
    contrast: 'with',
    requiredCapabilities: ['ct'],
    aliases: ['cta chest', 'ct angiogram chest'],
  }),
  vt(M, {
    id: 'VT-CT-SINUS-WO',
    code: 'CT250',
    displayName: 'CT Sinus without Contrast',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'CT',
    bodyRegion: 'sinus',
    contrast: 'without',
    requiredCapabilities: ['ct'],
    aliases: ['ct sinus', 'sinus ct'],
  }),

  /* ---------------- US ---------------- */
  vt(M, {
    id: 'VT-US-ABDOMEN-COMPLETE',
    code: 'US301',
    displayName: 'Ultrasound Abdomen Complete',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'abdomen',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    aliases: ['abdominal ultrasound', 'us abdomen complete'],
  }),
  vt(M, {
    id: 'VT-US-PELVIS',
    code: 'US310',
    displayName: 'Ultrasound Pelvis',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'pelvis',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    aliases: ['pelvic ultrasound'],
  }),
  vt(M, {
    id: 'VT-US-THYROID',
    code: 'US320',
    displayName: 'Ultrasound Thyroid',
    durationMinutes: 20,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'neck',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    // Deliberate collision with VT-US-NECK-SOFT-TISSUE.
    aliases: ['thyroid ultrasound', 'neck ultrasound'],
  }),
  vt(M, {
    id: 'VT-US-NECK-SOFT-TISSUE',
    code: 'US321',
    displayName: 'Ultrasound Neck Soft Tissue',
    durationMinutes: 20,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'neck',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    // Deliberate collision: same alias appears on VT-US-THYROID.
    aliases: ['soft tissue neck ultrasound', 'neck ultrasound'],
  }),
  vt(M, {
    id: 'VT-US-CAROTID-DUPLEX',
    code: 'US330',
    displayName: 'Ultrasound Carotid Duplex Bilateral',
    durationMinutes: 40,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'neck',
    laterality: 'bilateral',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    aliases: ['carotid duplex', 'carotid doppler'],
  }),
  vt(M, {
    id: 'VT-US-VENOUS-LE',
    code: 'US340',
    displayName: 'Ultrasound Venous Duplex Lower Extremity',
    durationMinutes: 45,
    specialty: 'imaging',
    modality: 'US',
    bodyRegion: 'lower_extremity',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    aliases: ['venous duplex leg', 'dvt ultrasound', 'leg vein ultrasound'],
  }),

  /* ---------------- XR ---------------- */
  vt(M, {
    id: 'VT-XR-CHEST-2V',
    code: 'XR401',
    displayName: 'X-Ray Chest 2 View',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'chest',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    aliases: ['chest xray', 'chest x-ray 2 view', 'cxr'],
  }),
  vt(M, {
    id: 'VT-XR-KNEE-3V',
    code: 'XR410',
    displayName: 'X-Ray Knee 3 View',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'knee',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    aliases: ['knee xray', 'knee x-ray'],
  }),
  vt(M, {
    id: 'VT-XR-LSPINE-2V',
    code: 'XR420',
    displayName: 'X-Ray Lumbar Spine 2 View',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'lumbar_spine',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    // Deliberate collision with VT-XR-LSPINE-COMPLETE.
    aliases: ['lumbar spine xray'],
  }),
  vt(M, {
    id: 'VT-XR-LSPINE-COMPLETE',
    code: 'XR421',
    displayName: 'X-Ray Lumbar Spine Complete 5 View',
    durationMinutes: 15,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'lumbar_spine',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    // Deliberate collision: same alias appears on VT-XR-LSPINE-2V.
    aliases: ['lumbar spine xray complete', 'lumbar spine xray'],
  }),
  vt(M, {
    id: 'VT-XR-FOOT-3V',
    code: 'XR430',
    displayName: 'X-Ray Foot 3 View',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'foot',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    aliases: ['foot xray', 'foot x-ray'],
  }),

  /* ---------------- MG ---------------- */
  vt(M, {
    id: 'VT-MG-SCREEN-BILAT',
    code: 'MG501',
    displayName: 'Screening Mammogram Bilateral',
    durationMinutes: 20,
    specialty: 'imaging',
    modality: 'MG',
    bodyRegion: 'breast',
    laterality: 'bilateral',
    contrast: 'not_applicable',
    requiredCapabilities: ['mammography'],
    aliases: ['screening mammogram', 'screening mammo'],
  }),
  vt(M, {
    id: 'VT-MG-DIAG-UNILAT',
    code: 'MG510',
    displayName: 'Diagnostic Mammogram Unilateral',
    durationMinutes: 30,
    specialty: 'imaging',
    modality: 'MG',
    bodyRegion: 'breast',
    contrast: 'not_applicable',
    requiredCapabilities: ['mammography'],
    aliases: ['diagnostic mammogram', 'diagnostic mammo'],
  }),

  /* ---------------- NM / other ---------------- */
  vt(M, {
    id: 'VT-NM-BONE-SCAN-WB',
    code: 'NM601',
    displayName: 'Nuclear Medicine Whole Body Bone Scan',
    durationMinutes: 180,
    specialty: 'imaging',
    modality: 'NM',
    bodyRegion: 'whole_body',
    contrast: 'not_applicable',
    requiredCapabilities: ['nuclear_medicine'],
    aliases: ['bone scan', 'whole body bone scan'],
  }),
  vt(M, {
    id: 'VT-NM-HIDA',
    code: 'NM610',
    displayName: 'Nuclear Medicine Hepatobiliary Scan',
    durationMinutes: 120,
    specialty: 'imaging',
    modality: 'NM',
    bodyRegion: 'abdomen',
    contrast: 'not_applicable',
    requiredCapabilities: ['nuclear_medicine'],
    aliases: ['hida scan', 'hepatobiliary scan'],
  }),
  vt(M, {
    id: 'VT-DEXA-BONE-DENSITY',
    code: 'DX701',
    displayName: 'DEXA Bone Density Scan',
    durationMinutes: 20,
    specialty: 'imaging',
    modality: 'DEXA',
    bodyRegion: 'whole_body',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    aliases: ['dexa scan', 'bone density scan', 'dxa'],
  }),
  vt(M, {
    id: 'VT-XR-WRIST-RETIRED',
    code: 'XR440',
    displayName: 'X-Ray Wrist 2 View (RETIRED)',
    durationMinutes: 10,
    specialty: 'imaging',
    modality: 'XR',
    bodyRegion: 'wrist',
    contrast: 'not_applicable',
    active: false,
    requiredCapabilities: ['xr'],
    aliases: ['wrist xray'],
  }),
];

/** Separate tenant. Used exclusively to prove cross-tenant reads fail closed. */
export const NORTHGATE_CATALOG: readonly VisitType[] = [
  vt('northgate-ortho', {
    id: 'VT-NG-XR-KNEE-4V',
    code: 'NGX101',
    displayName: 'X-Ray Knee 4 View (Northgate)',
    durationMinutes: 10,
    specialty: 'orthopedics',
    modality: 'XR',
    bodyRegion: 'knee',
    contrast: 'not_applicable',
    requiredCapabilities: ['xr'],
    aliases: ['knee xray', 'knee x-ray'],
  }),
  vt('northgate-ortho', {
    id: 'VT-NG-US-SHOULDER',
    code: 'NGU201',
    displayName: 'Ultrasound Shoulder (Northgate)',
    durationMinutes: 25,
    specialty: 'orthopedics',
    modality: 'US',
    bodyRegion: 'shoulder',
    contrast: 'not_applicable',
    requiredCapabilities: ['us'],
    aliases: ['shoulder ultrasound'],
  }),
];

export const CATALOGS: Readonly<Record<string, readonly VisitType[]>> = {
  'meridian-imaging': MERIDIAN_CATALOG,
  'northgate-ortho': NORTHGATE_CATALOG,
};

/** Every identifier the resolver is permitted to emit, per tenant. */
export function catalogIdsFor(tenantId: string): ReadonlySet<string> {
  return new Set((CATALOGS[tenantId] ?? []).map((v) => v.id));
}
