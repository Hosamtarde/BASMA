import { collectOnValid, decideDelivery, deliveryDue, DeliveryRequest } from './delivery-rules';

describe('deliveryDue (N1)', () => {
  it.each([
    ['nothing paid', 40_000, 0, 40_000, 40_000],
    ['a pending cheque bound to the case is subtracted', 40_000, 15_000, 25_000, 25_000],
    ['pending cheques above what is unpaid', 10_000, 15_000, 0, 0],
    ['fully paid', 0, 0, 0, 0],
    ['overpaid (FIFO gives 0)', 0, 0, 0, 0],
    ['never above the bound limit', 30_000, 0, 20_000, 20_000],
  ])('%s', (_l, remaining, pending, room, expected) => {
    expect(deliveryDue(remaining, pending, room)).toBe(expected);
  });
});

describe('decideDelivery (N1–N4)', () => {
  const D = '2026-11-10';
  const ok = (req: DeliveryRequest, due: number) => decideDelivery(req, due, D);

  describe('nothing due', () => {
    it('accepts no answer or "full" without a payment', () => {
      expect(ok({}, 0)).toEqual({ ok: true, paymentAmount: 0, collectOn: null });
      expect(ok({ received: 'full' }, 0)).toEqual({ ok: true, paymentAmount: 0, collectOn: null });
    });
    it.each([
      [{ received: 'partial', amount: 5 }, 'error.delivery.nothing_due'],
      [{ received: 'none', collectOn: D }, 'error.delivery.nothing_due'],
      [{ method: 'cash' }, 'error.delivery.amount_not_allowed'],
      [{ amount: 5 }, 'error.delivery.amount_not_allowed'],
      [{ collectOn: D }, 'error.delivery.collect_on_not_allowed'],
    ] as const)('refuses %j', (req, code) => {
      expect(ok(req, 0)).toMatchObject({ ok: false, code });
    });
  });

  describe('something due', () => {
    it('needs an answer', () => {
      expect(ok({}, 100)).toMatchObject({ ok: false, code: 'error.delivery.received_required', status: 400 });
    });
    it('full: a payment for exactly the amount due, no collect date', () => {
      expect(ok({ received: 'full', method: 'cash' }, 100)).toEqual({ ok: true, paymentAmount: 100, collectOn: null });
      expect(ok({ received: 'full', method: 'cash', amount: 100 }, 100)).toMatchObject({
        code: 'error.delivery.amount_not_allowed',
      });
      expect(ok({ received: 'full', method: 'cash', collectOn: D }, 100)).toMatchObject({
        code: 'error.delivery.collect_on_not_allowed',
      });
      expect(ok({ received: 'full' }, 100)).toMatchObject({ code: 'error.delivery.method_required' });
    });
    it('partial: 0 < amount < due and a collect date', () => {
      expect(ok({ received: 'partial', method: 'cheque', amount: 40, collectOn: '2026-12-01' }, 100)).toEqual({
        ok: true,
        paymentAmount: 40,
        collectOn: '2026-12-01',
      });
      expect(ok({ received: 'partial', method: 'cash', collectOn: D }, 100)).toMatchObject({
        code: 'error.delivery.amount_required',
      });
      expect(ok({ received: 'partial', method: 'cash', amount: 100, collectOn: D }, 100)).toMatchObject({
        code: 'error.delivery.partial_equals_due',
        status: 400,
      });
      expect(ok({ received: 'partial', method: 'cash', amount: 101, collectOn: D }, 100)).toEqual({
        ok: false,
        code: 'error.delivery.exceeds_remaining',
        status: 409,
        params: { max: 100 },
      });
      expect(ok({ received: 'partial', method: 'cash', amount: 40 }, 100)).toMatchObject({
        code: 'error.delivery.collect_on_required',
      });
      expect(ok({ received: 'partial', method: 'cash', amount: 40, collectOn: '2026-11-09' }, 100)).toMatchObject({
        code: 'error.delivery.collect_on_invalid',
      });
    });
    it('none: no payment, a collect date on or after the delivery date', () => {
      expect(ok({ received: 'none', collectOn: D }, 100)).toEqual({ ok: true, paymentAmount: 0, collectOn: D });
      expect(ok({ received: 'none' }, 100)).toMatchObject({ code: 'error.delivery.collect_on_required' });
      expect(ok({ received: 'none', method: 'cash', collectOn: D }, 100)).toMatchObject({
        code: 'error.delivery.amount_not_allowed',
      });
      expect(ok({ received: 'none', amount: 5, collectOn: D }, 100)).toMatchObject({
        code: 'error.delivery.amount_not_allowed',
      });
    });
  });
});

describe('collectOnValid (N2)', () => {
  it.each([
    ['2026-11-10', '2026-11-10', true],
    ['2026-12-01', '2026-11-10', true],
    ['2026-11-09', '2026-11-10', false],
    ['2026-12-31', '2027-01-01', false],
    ['2027-01-01', '2026-12-31', true],
  ])('%s vs delivered %s', (collectOn, delivered, ok) => {
    expect(collectOnValid(collectOn, delivered)).toBe(ok);
  });
});
