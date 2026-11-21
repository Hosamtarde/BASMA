import { auditEntity } from '../../audit/domain/audit-feed-rules';
import { fieldProblem, isInvoiceable, snapshotSha256 } from './invoice-rules';

describe('invoice rules (B6)', () => {
  it('only delivered and ready cases can be invoiced (SPEC §5.14, I5)', () => {
    const all = ['waiting', 'design', 'in_progress', 'ready', 'delivered', 'returned', 'cancelled'];
    expect(all.filter(isInvoiceable)).toEqual(['ready', 'delivered']);
  });

  it('hashes the canonical JSON: key order and spacing never change the digest', () => {
    const a = { b: 1, a: { y: [1, 2, { q: 'ب', p: null }], x: true } };
    const b = JSON.parse('{ "a": { "x": true, "y": [1, 2, { "p": null, "q": "ب" }] }, "b": 1 }') as unknown;
    expect(snapshotSha256(a)).toBe(snapshotSha256(b));
    expect(snapshotSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotSha256({ ...a, b: 2 })).not.toBe(snapshotSha256(a));
    // Array order is content.
    expect(snapshotSha256({ l: [1, 2] })).not.toBe(snapshotSha256({ l: [2, 1] }));
  });

  describe('fieldProblem: which request fields each type takes', () => {
    it('cases: doctor, case ids and the previewed total are required; statement/free fields are refused', () => {
      expect(fieldProblem('cases', { doctorId: 1, caseIds: [1], expectedTotal: 0 })).toBeNull();
      expect(fieldProblem('cases', { doctorId: 1, caseIds: [1] })).toEqual({ field: 'expectedTotal', rule: 'required' });
      expect(fieldProblem('cases', { doctorId: 1, caseIds: [1], expectedTotal: 0, amount: 5 })).toEqual({
        field: 'amount',
        rule: 'forbidden',
      });
      expect(fieldProblem('cases', { doctorId: 1, caseIds: [1], expectedTotal: 0, from: '2026-01-01' })).toEqual({
        field: 'from',
        rule: 'forbidden',
      });
    });

    it('statement: a doctor and an optional range; no cases, no amount', () => {
      expect(fieldProblem('statement', { doctorId: 1 })).toBeNull();
      expect(fieldProblem('statement', { doctorId: 1, from: '2026-01-01', to: '2026-02-01', notes: 'x' })).toBeNull();
      expect(fieldProblem('statement', {})).toEqual({ field: 'doctorId', rule: 'required' });
      expect(fieldProblem('statement', { doctorId: 1, caseIds: [1] })).toEqual({ field: 'caseIds', rule: 'forbidden' });
    });

    it('free: a reason and an amount; the party is checked by the service (doctor XOR name)', () => {
      expect(fieldProblem('free', { reason: 'r', amount: 1, partyName: 'x' })).toBeNull();
      expect(fieldProblem('free', { amount: 1 })).toEqual({ field: 'reason', rule: 'required' });
      expect(fieldProblem('free', { reason: 'r', amount: 1, expectedTotal: 1 })).toEqual({
        field: 'expectedTotal',
        rule: 'forbidden',
      });
    });

    it('treats null as absent', () => {
      expect(fieldProblem('statement', { doctorId: 1, caseIds: null })).toBeNull();
    });
  });

  it('the Home feed labels invoice entries by their number only (never the reason or the party)', () => {
    expect(auditEntity('invoice.created', 'invoice', { invoiceNo: 1001, party: 'Dr X', total: 5000 })).toEqual({
      entityType: 'invoice',
      entityLabel: '1001',
    });
    expect(auditEntity('invoice.voided', 'invoice', { invoiceNo: 1001, reason: 'secret' })).toEqual({
      entityType: 'invoice',
      entityLabel: '1001',
    });
  });
});
