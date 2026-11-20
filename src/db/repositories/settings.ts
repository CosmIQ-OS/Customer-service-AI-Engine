import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';
import {
  DEFAULT_QUOTE_MARGIN,
  MAX_QUOTE_MARGIN,
  MIN_QUOTE_MARGIN,
  normalizeMarginPercent,
} from '../../pricing/margin.js';

export const QUOTE_MARGIN_KEY = 'quote_margin_percent';
export const COMPANY_SIZE_MULTIPLIERS_KEY = 'company_size_multipliers';
export const DEFAULT_TERMS_KEY = 'default_terms_and_conditions';

export const COMPANY_SIZE_KEYS = ['0-5', '5-10', '10-20', '20+'] as const;
export type CompanySizeKey = (typeof COMPANY_SIZE_KEYS)[number];
export type CompanySizeMultipliers = Record<CompanySizeKey, number>;

export const DEFAULT_COMPANY_SIZE_MULTIPLIERS: CompanySizeMultipliers = {
  '0-5': 1.0,
  '5-10': 1.5,
  '10-20': 2.0,
  '20+': 3.0,
};

export const DEFAULT_TERMS_AND_CONDITIONS = [
  '1. Proposal Validity: This proposal is valid for 14 calendar days from the proposal date unless extended in writing by CosmIQ OS.',
  '2. Scope & Change Requests: Deliverables are limited to the services and line items specified in this proposal. Any additional integrations, custom workflows, or scope changes will be scoped and billed separately via a written change order.',
  '3. Pricing & Payment Terms: All prices are quoted in Indian Rupees (INR) and are exclusive of applicable GST or statutory taxes unless explicitly stated. Standard billing is 50% upfront upon proposal acceptance to initiate onboarding and 50% upon milestone completion/go-live, payable within 7 days of invoice.',
  '4. Client Responsibilities: Timely access to required workspaces, API credentials, stakeholder feedback, and test environments is required to meet estimated deployment timelines.',
  '5. Confidentiality & Intellectual Property: Both parties agree to treat non-public business, technical, and pricing information as confidential. Upon full payment, client-specific configurations and workflows are licensed/assigned as agreed, while CosmIQ OS retains ownership of its core frameworks, libraries, and reusable tooling.',
  '6. Governing Terms: Acceptance of this proposal constitutes agreement to CosmIQ OS standard service delivery terms and applicable Indian law.',
].join('\n\n');

export interface AppSettings {
  quoteMarginPercent: number;
  minMarginPercent: number;
  maxMarginPercent: number;
  companySizeMultipliers: CompanySizeMultipliers;
  defaultTermsAndConditions: string;
}

export async function getSetting(db: DBExecutor, key: string): Promise<string | undefined> {
  const row = await db.queryOne<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return row?.value;
}

export async function setSetting(
  db: DBExecutor,
  key: string,
  value: string,
  updatedBy: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = ${UTC_NOW_SQL}`,
    [key, value, updatedBy],
  );
}

/** Returns the live margin. Admins can change it at any time within the allowed range. */
export async function getQuoteMarginPercent(db: DBExecutor): Promise<number> {
  const raw = await getSetting(db, QUOTE_MARGIN_KEY);
  if (raw === undefined) return DEFAULT_QUOTE_MARGIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_QUOTE_MARGIN || value > MAX_QUOTE_MARGIN) {
    return DEFAULT_QUOTE_MARGIN;
  }
  return value;
}

export async function setQuoteMarginPercent(
  db: DBExecutor,
  value: number,
  updatedBy: number | null,
): Promise<number> {
  const normalized = normalizeMarginPercent(value);
  await setSetting(db, QUOTE_MARGIN_KEY, String(normalized), updatedBy);
  return normalized;
}

/** Seeds the starting margin once; later admin edits are never overwritten. */
export async function ensureQuoteMarginSetting(db: DBExecutor, seedPercent: number): Promise<number> {
  if ((await getSetting(db, QUOTE_MARGIN_KEY)) !== undefined) return getQuoteMarginPercent(db);
  return setQuoteMarginPercent(db, seedPercent, null);
}

export function normalizeCompanySizeMultipliers(input: CompanySizeMultipliers): CompanySizeMultipliers {
  const normalized = {} as CompanySizeMultipliers;
  for (const key of COMPANY_SIZE_KEYS) {
    const val = input[key];
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
      throw new Error(`Multiplier for "${key}" must be a positive finite number.`);
    }
    normalized[key] = val;
  }
  return normalized;
}

export async function getCompanySizeMultipliers(db: DBExecutor): Promise<CompanySizeMultipliers> {
  const raw = await getSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY);
  if (raw === undefined) return { ...DEFAULT_COMPANY_SIZE_MULTIPLIERS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_COMPANY_SIZE_MULTIPLIERS };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_COMPANY_SIZE_MULTIPLIERS };
  }

  const record = parsed as Record<string, unknown>;
  const result = { ...DEFAULT_COMPANY_SIZE_MULTIPLIERS };
  for (const key of COMPANY_SIZE_KEYS) {
    const val = record[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      result[key] = val;
    }
  }
  return result;
}

export async function setCompanySizeMultipliers(
  db: DBExecutor,
  value: CompanySizeMultipliers,
  updatedBy: number | null,
): Promise<CompanySizeMultipliers> {
  const normalized = normalizeCompanySizeMultipliers(value);
  await setSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY, JSON.stringify(normalized), updatedBy);
  return normalized;
}

export async function getDefaultTermsAndConditions(db: DBExecutor): Promise<string> {
  const raw = await getSetting(db, DEFAULT_TERMS_KEY);
  return raw === undefined ? DEFAULT_TERMS_AND_CONDITIONS : raw;
}

export async function setDefaultTermsAndConditions(
  db: DBExecutor,
  value: string,
  updatedBy: number | null,
): Promise<string> {
  if (typeof value !== 'string') {
    throw new Error('defaultTermsAndConditions must be a string.');
  }
  if (value.length > 50_000) {
    throw new Error('defaultTermsAndConditions must be 50,000 characters or fewer.');
  }
  await setSetting(db, DEFAULT_TERMS_KEY, value, updatedBy);
  return value;
}

export async function getAllSettings(db: DBExecutor): Promise<AppSettings> {
  const [quoteMarginPercent, companySizeMultipliers, defaultTermsAndConditions] = await Promise.all([
    getQuoteMarginPercent(db),
    getCompanySizeMultipliers(db),
    getDefaultTermsAndConditions(db),
  ]);
  return {
    quoteMarginPercent,
    minMarginPercent: MIN_QUOTE_MARGIN,
    maxMarginPercent: MAX_QUOTE_MARGIN,
    companySizeMultipliers,
    defaultTermsAndConditions,
  };
}

export async function updateSettings(
  db: DB,
  patch: {
    quoteMarginPercent?: number;
    companySizeMultipliers?: CompanySizeMultipliers;
    defaultTermsAndConditions?: string;
  },
  updatedBy: number | null,
): Promise<AppSettings> {
  if (
    patch.quoteMarginPercent === undefined &&
    patch.companySizeMultipliers === undefined &&
    patch.defaultTermsAndConditions === undefined
  ) {
    throw new Error('Send at least one setting to update.');
  }

  const normalizedMargin =
    patch.quoteMarginPercent !== undefined ? normalizeMarginPercent(patch.quoteMarginPercent) : undefined;
  const normalizedMultipliers =
    patch.companySizeMultipliers !== undefined
      ? normalizeCompanySizeMultipliers(patch.companySizeMultipliers)
      : undefined;
  let normalizedTerms: string | undefined;
  if (patch.defaultTermsAndConditions !== undefined) {
    if (typeof patch.defaultTermsAndConditions !== 'string') {
      throw new Error('defaultTermsAndConditions must be a string.');
    }
    if (patch.defaultTermsAndConditions.length > 50_000) {
      throw new Error('defaultTermsAndConditions must be 50,000 characters or fewer.');
    }
    normalizedTerms = patch.defaultTermsAndConditions;
  }

  return db.transaction(async (tx) => {
    if (normalizedMargin !== undefined) {
      await setSetting(tx, QUOTE_MARGIN_KEY, String(normalizedMargin), updatedBy);
    }
    if (normalizedMultipliers !== undefined) {
      await setSetting(tx, COMPANY_SIZE_MULTIPLIERS_KEY, JSON.stringify(normalizedMultipliers), updatedBy);
    }
    if (normalizedTerms !== undefined) {
      await setSetting(tx, DEFAULT_TERMS_KEY, normalizedTerms, updatedBy);
    }
    return getAllSettings(tx);
  });
}

export async function ensureDefaultSettings(db: DBExecutor, seedMarginPercent: number): Promise<AppSettings> {
  await ensureQuoteMarginSetting(db, seedMarginPercent);
  if ((await getSetting(db, COMPANY_SIZE_MULTIPLIERS_KEY)) === undefined) {
    await setCompanySizeMultipliers(db, DEFAULT_COMPANY_SIZE_MULTIPLIERS, null);
  }
  if ((await getSetting(db, DEFAULT_TERMS_KEY)) === undefined) {
    await setDefaultTermsAndConditions(db, DEFAULT_TERMS_AND_CONDITIONS, null);
  }
  return getAllSettings(db);
}
