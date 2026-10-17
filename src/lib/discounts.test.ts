// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeOrderDiscount, discountCentavosFor, maskIdNumber, personErrors, pickHigherDiscount, roundMoney, IS_VAT_REGISTERED } from './discounts.ts'
import type { CartLine, DiscountPerson } from './discounts.ts'

const senior = (overrides: Partial<DiscountPerson> = {}): DiscountPerson => ({
  type: 'senior', fullName: 'Juan Dela Cruz', idType: 'osca', idNumber: 'OSCA-0001', idVerified: true, ...overrides,
})
const pwd = (overrides: Partial<DiscountPerson> = {}): DiscountPerson => ({
  type: 'pwd', fullName: 'Maria Santos', idType: 'pwd_id', idNumber: 'PWD-1234-5678', idVerified: true, ...overrides,
})
const line = (id: string, price: number, quantity = 1, extra: Partial<CartLine> = {}): CartLine => ({ id, name: id, price, quantity, ...extra })

test('business is non-VAT: the VAT-exempt formula is off', () => {
  assert.equal(IS_VAT_REGISTERED, false)
})

test('₱112 single SC item → discount ₱22.40, total ₱89.60', () => {
  const r = computeOrderDiscount({ cart: [line('Latte', 112)], mode: 'items', people: [senior({ items: [{ lineId: 'Latte', qty: 1 }] })] })
  assert.equal(r.ok, true, r.errors.join(' '))
  assert.equal(r.orderGross, 112)
  assert.equal(r.discountTotal, 22.4)
  assert.equal(r.orderNet, 89.6)
  assert.deepEqual([r.people[0].gross, r.people[0].discount, r.people[0].net], [112, 22.4, 89.6])
})

test('₱1,000 shared bill, 4 diners, 1 SC → discount ₱50.00, total ₱950.00', () => {
  const r = computeOrderDiscount({ cart: [line('Platter', 1000)], mode: 'shared', diners: 4, people: [senior()] })
  assert.equal(r.ok, true, r.errors.join(' '))
  assert.equal(r.people[0].gross, 250)
  assert.equal(r.discountTotal, 50)
  assert.equal(r.orderNet, 950)
})

test('shared mode: 2 of 4 diners discounted', () => {
  const r = computeOrderDiscount({ cart: [line('Platter', 1000)], mode: 'shared', diners: 4, people: [senior(), pwd()] })
  assert.equal(r.ok, true, r.errors.join(' '))
  assert.equal(r.discountTotal, 100)
  assert.equal(r.orderNet, 900)
})

test('shared mode: uneven split rounds the share to the centavo', () => {
  // 1000 / 3 = 333.33 share → 20% = 66.67 (66.666 rounded)
  const r = computeOrderDiscount({ cart: [line('Platter', 1000)], mode: 'shared', diners: 3, people: [senior()] })
  assert.equal(r.people[0].gross, 333.33)
  assert.equal(r.people[0].discount, 66.67)
  assert.equal(r.people[0].net, 266.66)
  assert.equal(r.orderNet, 933.33)
})

test('item mode: only the assigned units are discounted, not the whole bill', () => {
  const cart = [line('Latte', 150, 2), line('Cake', 120)]
  const r = computeOrderDiscount({ cart, mode: 'items', people: [senior({ items: [{ lineId: 'Latte', qty: 1 }] })] })
  assert.equal(r.ok, true, r.errors.join(' '))
  assert.equal(r.orderGross, 420)
  assert.equal(r.discountTotal, 30)
  assert.equal(r.orderNet, 390)
})

test('item mode: add-ons count toward the item price', () => {
  const cart = [line('Latte', 140, 1, { addOns: [{ name: 'Extra Shot', price: 35 }, { name: 'less ice' }] })]
  const r = computeOrderDiscount({ cart, mode: 'items', people: [senior({ items: [{ lineId: 'Latte', qty: 1 }] })] })
  assert.equal(r.people[0].gross, 175)
  assert.equal(r.discountTotal, 35)
})

test('item mode: two people, each with their own record', () => {
  const cart = [line('Latte', 150, 2), line('Cake', 120)]
  const r = computeOrderDiscount({
    cart, mode: 'items',
    people: [senior({ items: [{ lineId: 'Latte', qty: 1 }] }), pwd({ items: [{ lineId: 'Latte', qty: 1 }, { lineId: 'Cake', qty: 1 }] })],
  })
  assert.equal(r.ok, true, r.errors.join(' '))
  assert.deepEqual(r.people.map(p => p.discount), [30, 54])
  assert.equal(r.discountTotal, 84)
  assert.equal(r.orderNet, 336)
})

test('centavo prices do not drift (floating point)', () => {
  const r = computeOrderDiscount({ cart: [line('Tea', 135.55, 3)], mode: 'items', people: [senior({ items: [{ lineId: 'Tea', qty: 3 }] })] })
  // 406.65 × 20% = 81.33
  assert.equal(r.people[0].gross, 406.65)
  assert.equal(r.discountTotal, 81.33)
  assert.equal(r.orderNet, 325.32)
})

test('packaging fee is never discountable — shared mode leaves it out of the base', () => {
  const cart = [line('Platter', 1000), line('fee', 20, 1, { name: 'Packaging Fee' })]
  const r = computeOrderDiscount({ cart, mode: 'shared', diners: 4, people: [senior()] })
  assert.equal(r.orderGross, 1020)
  assert.equal(r.people[0].gross, 250)
  assert.equal(r.discountTotal, 50)
  assert.equal(r.orderNet, 970)
})

test('packaging fee is never discountable — item mode rejects assigning it', () => {
  const cart = [line('Latte', 112), line('fee', 20, 1, { name: 'Packaging Fee' })]
  const r = computeOrderDiscount({ cart, mode: 'items', people: [senior({ items: [{ lineId: 'Latte', qty: 1 }, { lineId: 'fee', qty: 1 }] })] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /Packaging Fee can't be discounted/)
  assert.equal(r.discountTotal, 22.4)
})

test('item mode: cannot assign more units than the order has', () => {
  const cart = [line('Latte', 150, 1)]
  const r = computeOrderDiscount({
    cart, mode: 'items',
    people: [senior({ items: [{ lineId: 'Latte', qty: 1 }] }), pwd({ items: [{ lineId: 'Latte', qty: 1 }] })],
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /2 assigned but only 1/)
})

test('item mode: each person must cover at least one item', () => {
  const r = computeOrderDiscount({ cart: [line('Latte', 150)], mode: 'items', people: [senior({ items: [] })] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /at least one item/)
})

test('one discount per person: the same ID twice is rejected (spacing/dashes ignored)', () => {
  const r = computeOrderDiscount({
    cart: [line('Platter', 1000)], mode: 'shared', diners: 4,
    people: [senior({ idNumber: 'osca-0001' }), senior({ fullName: 'Someone Else', idNumber: 'OSCA 0001' })],
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /already used/)
})

test('shared mode: more SC/PWD people than diners is rejected', () => {
  const r = computeOrderDiscount({ cart: [line('Platter', 1000)], mode: 'shared', diners: 1, people: [senior(), pwd()] })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /only 1 diners/)
})

test('shared mode: diners must be entered', () => {
  const r = computeOrderDiscount({ cart: [line('Platter', 1000)], mode: 'shared', diners: 0, people: [senior()] })
  assert.equal(r.ok, false)
  assert.equal(r.discountTotal, 0)
})

test('no SC/PWD people → no discount, order unchanged', () => {
  const r = computeOrderDiscount({ cart: [line('Latte', 112)], mode: 'items', people: [] })
  assert.equal(r.ok, true)
  assert.equal(r.discountTotal, 0)
  assert.equal(r.orderNet, 112)
})

test('required details: every field plus the "ID verified" tick', () => {
  assert.deepEqual(personErrors(senior()), [])
  const blank: DiscountPerson = { type: '', fullName: ' ', idType: '', idNumber: '', idVerified: false }
  assert.equal(personErrors(blank).length, 5)
  assert.match(personErrors(senior({ idVerified: false })).join(' '), /ID verified/)
  assert.match(personErrors(senior({ idType: 'pwd_id' })).join(' '), /needs: OSCA ID or Other government ID/)
  const r = computeOrderDiscount({ cart: [line('Latte', 112)], mode: 'items', people: [senior({ idVerified: false, items: [{ lineId: 'Latte', qty: 1 }] })] })
  assert.equal(r.ok, false)
})

test('ID rule: SC may use OSCA or another government ID; PWD must use a PWD ID', () => {
  assert.deepEqual(personErrors(senior({ idType: 'osca' })), [])
  assert.deepEqual(personErrors(senior({ idType: 'gov_id', idNumber: 'P1234567A' })), [])
  assert.deepEqual(personErrors(pwd({ idType: 'pwd_id' })), [])
  assert.match(personErrors(pwd({ idType: 'gov_id' })).join(' '), /PWD needs: PWD ID/)
  assert.match(personErrors(pwd({ idType: 'osca' })).join(' '), /PWD needs: PWD ID/)
})

test('VAT-exempt branch (disabled) still computes ₱112 → ₱80 when switched on', () => {
  assert.equal(discountCentavosFor(11200), 2240) // current: flat 20%
  assert.equal(discountCentavosFor(11200, true), 3200) // 112 ÷ 1.12 = 100, 20% off = 80
})

test('no stacking: whichever discount is higher wins', () => {
  assert.equal(pickHigherDiscount(22.4), 'sc_pwd')
  assert.equal(pickHigherDiscount(22.4, 30), 'promo')
  assert.equal(pickHigherDiscount(30, 30), 'sc_pwd')
  assert.equal(pickHigherDiscount(0, 0), 'none')
})

test('roundMoney rounds to 2 decimals', () => {
  assert.equal(roundMoney(89.6000000001), 89.6)
  assert.equal(roundMoney(66.666), 66.67)
})

test('ID numbers are masked to the last 4 on screen', () => {
  assert.equal(maskIdNumber('PWD-1234-5678'), '••••••••5678')
  assert.equal(maskIdNumber('OSCA0001'), '••••0001')
  assert.equal(maskIdNumber('123'), '•••')
  assert.equal(maskIdNumber(null), '')
})
