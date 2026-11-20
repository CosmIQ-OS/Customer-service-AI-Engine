export const INTAKE_FIELDS = ['company_name', 'company_size', 'current_tools', 'service_name'] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];

export const INTAKE_STATUSES = ['collecting', 'collected', 'quoted', 'deal_won', 'completed'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export interface IntakeRecord {
  id: number;
  session_id: string;
  channel: string;
  external_user_id: string;
  company_name: string;
  company_size: string;
  current_tools: string;
  service_id: number | null;
  service_name: string;
  language: string;
  status: IntakeStatus;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export function isIntakeReady(status: string): boolean {
  return status !== 'collecting';
}

export type IntakeInput = Partial<Record<IntakeField, string>> & {
  service_id?: number | null;
  language?: string;
};

export function assignedFields(intake: Pick<IntakeRecord, IntakeField>): IntakeField[] {
  return INTAKE_FIELDS.filter((field) => intake[field].trim().length > 0);
}

export function missingIntakeFields(intake: Pick<IntakeRecord, IntakeField>): IntakeField[] {
  return INTAKE_FIELDS.filter((field) => intake[field].trim().length === 0);
}

export function isIntakeComplete(intake: Pick<IntakeRecord, IntakeField>): boolean {
  return missingIntakeFields(intake).length === 0;
}
