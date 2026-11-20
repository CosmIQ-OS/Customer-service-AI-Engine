import { UTC_NOW_SQL, type DB, type DBExecutor } from '../database.js';

export type ContractProposalStatus = 'sent' | 'pending' | 'accepted' | 'rejected';

export interface ContractProposalRecord {
  id: number;
  proposal_number: string;
  intake_id: number | null;
  session_id: string | null;
  channel: string;
  our_company_name: string;
  our_company_details: string;
  client_company: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_designation: string;
  proposal_date: string;
  scope_of_project: string;
  phases_and_timeline: string;
  payment_schedules: string;
  success_metrics: string;
  ongoing_cost: string;
  support_and_warranty: string;
  data_privacy: string;
  include_signing: boolean;
  signer_name: string;
  signer_designation: string;
  signer_signature_data: string;
  client_signature_data: string;
  status: ContractProposalStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractProposalInput {
  intakeId?: number | null;
  sessionId?: string | null;
  channel?: string;
  ourCompanyName?: string;
  ourCompanyDetails?: string;
  clientCompany: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientDesignation?: string;
  proposalDate?: string;
  scopeOfProject?: string;
  phasesAndTimeline?: string;
  paymentSchedules?: string;
  successMetrics?: string;
  ongoingCost?: string;
  supportAndWarranty?: string;
  dataPrivacy?: string;
  includeSigning?: boolean;
  signerName?: string;
  signerDesignation?: string;
  signerSignatureData?: string;
  clientSignatureData?: string;
  status?: ContractProposalStatus;
  createdBy?: string;
}

function mapProposal(row: ContractProposalRecord): ContractProposalRecord {
  return {
    ...row,
    id: Number(row.id),
    intake_id: row.intake_id === null ? null : Number(row.intake_id),
    include_signing: Boolean(row.include_signing),
  };
}

export async function listContractProposals(db: DBExecutor, limit = 100): Promise<ContractProposalRecord[]> {
  const { rows } = await db.query<ContractProposalRecord>(
    'SELECT * FROM contract_proposals ORDER BY created_at DESC, id DESC LIMIT $1',
    [limit],
  );
  return rows.map(mapProposal);
}

export async function getContractProposal(db: DBExecutor, id: number): Promise<ContractProposalRecord | undefined> {
  const row = await db.queryOne<ContractProposalRecord>('SELECT * FROM contract_proposals WHERE id = $1', [id]);
  return row ? mapProposal(row) : undefined;
}

export async function createContractProposal(db: DB, input: ContractProposalInput): Promise<ContractProposalRecord> {
  return db.transaction(async (tx) => {
    const nextRow = await tx.queryOne<{ next: number }>(
      'SELECT (COALESCE(MAX(id), 0) + 1)::int AS next FROM contract_proposals',
    );
    const next = Number(nextRow?.next ?? 1);
    const proposalNumber = `PROP-${new Date().getUTCFullYear()}-${String(next).padStart(4, '0')}`;
    const proposalDate =
      input.proposalDate?.trim() || new Date().toISOString().slice(0, 10);

    const row = await tx.queryOne<ContractProposalRecord>(
      `INSERT INTO contract_proposals
        (proposal_number, intake_id, session_id, channel, our_company_name, our_company_details,
         client_company, client_name, client_email, client_phone, client_designation, proposal_date,
         scope_of_project, phases_and_timeline, payment_schedules, success_metrics,
         ongoing_cost, support_and_warranty, data_privacy, include_signing,
         signer_name, signer_designation, signer_signature_data, client_signature_data,
         status, created_by)
       VALUES
        ($1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, $19, $20,
         $21, $22, $23, $24,
         $25, $26)
       RETURNING *`,
      [
        proposalNumber,
        input.intakeId ?? null,
        input.sessionId ?? null,
        input.channel ?? 'direct',
        input.ourCompanyName?.trim() || 'Cosmiq OS',
        input.ourCompanyDetails ?? '',
        input.clientCompany.trim(),
        input.clientName?.trim() ?? '',
        input.clientEmail?.trim() ?? '',
        input.clientPhone?.trim() ?? '',
        input.clientDesignation?.trim() || 'Director',
        proposalDate,
        input.scopeOfProject ?? '',
        input.phasesAndTimeline ?? '',
        input.paymentSchedules ?? '',
        input.successMetrics ?? '',
        input.ongoingCost ?? '',
        input.supportAndWarranty ?? '',
        input.dataPrivacy ?? '',
        input.includeSigning ?? true,
        input.signerName?.trim() ?? '',
        input.signerDesignation?.trim() || 'Co-Founder',
        input.signerSignatureData ?? '',
        input.clientSignatureData ?? '',
        input.status ?? 'pending',
        input.createdBy ?? 'admin',
      ],
    );
    return mapProposal(row!);
  });
}

export async function updateContractProposalStatus(
  db: DBExecutor,
  id: number,
  status: ContractProposalStatus,
): Promise<ContractProposalRecord | undefined> {
  const row = await db.queryOne<ContractProposalRecord>(
    `UPDATE contract_proposals
     SET status = $1, updated_at = ${UTC_NOW_SQL}
     WHERE id = $2
     RETURNING *`,
    [status, id],
  );
  return row ? mapProposal(row) : undefined;
}
