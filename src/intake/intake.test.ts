import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignedFields, isIntakeComplete, missingIntakeFields, type IntakeRecord } from './intake.js';

const empty = { company_name: '', company_size: '', current_tools: '', service_name: '' };

function intake(patch: Partial<IntakeRecord>) {
  return { ...empty, ...patch } as IntakeRecord;
}

describe('intake helpers', () => {
  it('lists every missing field in order', () => {
    assert.deepEqual(missingIntakeFields(empty), [
      'company_name',
      'company_size',
      'current_tools',
      'service_name',
    ]);
  });

  it('ignores whitespace-only values', () => {
    const record = intake({ company_name: 'Acme', company_size: '  ', current_tools: 'Slack' });
    assert.deepEqual(assignedFields(record), ['company_name', 'current_tools']);
    assert.deepEqual(missingIntakeFields(record), ['company_size', 'service_name']);
  });

  it('is complete only when all four fields have values', () => {
    assert.equal(isIntakeComplete(empty), false);
    assert.equal(isIntakeComplete(intake({
      company_name: 'Acme',
      company_size: '120 employees',
      current_tools: 'Slack',
      service_name: 'Workflow Automation',
    })), true);
  });
});
