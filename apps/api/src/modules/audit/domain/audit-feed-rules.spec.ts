import { auditEntity } from './audit-feed-rules';

describe('auditEntity', () => {
  it('takes the label from a whitelisted parameter only', () => {
    expect(auditEntity('case.created', 'case', { caseNo: 12, doctor: 'Dr X', total: 500 })).toEqual({
      entityType: 'case',
      entityLabel: '12',
    });
    expect(auditEntity('payment.voided', 'payment', { voucherNo: 'IN-000031', reason: 'secret', amount: 9 })).toEqual({
      entityType: 'payment',
      entityLabel: 'IN-000031',
    });
    expect(auditEntity('doctor.created', 'doctor', { name: 'Dr Y', openingBalance: 5 }).entityLabel).toBe('Dr Y');
    expect(auditEntity('cheque.status_changed', 'cheque', { chequeNo: 'CH-1', voucherNo: 'IN-1' }).entityLabel).toBe('CH-1');
  });

  it('has no label for system actions, missing or empty parameters', () => {
    expect(auditEntity('settings.logo_removed', 'settings', { mimeType: 'image/png' }).entityLabel).toBeNull();
    expect(auditEntity('auth.password_changed', 'user', {}).entityLabel).toBeNull();
    expect(auditEntity('case.updated', 'case', {}).entityLabel).toBeNull();
    expect(auditEntity('doctor.updated', 'doctor', { name: '  ' }).entityLabel).toBeNull();
    expect(auditEntity('x.y', null, {}).entityType).toBe('');
  });

  it('never returns an object parameter and cuts a long label', () => {
    expect(auditEntity('doctor.created', 'doctor', { name: { a: 1 } }).entityLabel).toBeNull();
    expect(auditEntity('doctor.created', 'doctor', { name: 'x'.repeat(300) }).entityLabel).toHaveLength(100);
  });
});
