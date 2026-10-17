// Senior Citizen (SC) / PWD discount math — the one place it's computed, so
// Checkout, receipts and the discount log can never disagree. Pure (no UI,
// no Supabase) so it can be tested directly: npm test
//
// Rules (Philippines, NON-VAT registered business):
//   - 20% off the SC/PWD customer's OWN portion, never the whole bill.
//   - Item mode: the cashier assigns cart units to each person.
//   - Shared-meal mode: (eligible total ÷ diners) is one share; each SC/PWD
//     person gets 20% off one share.
//   - One discount per qualified person; one mode per order.
//   - Order-level charges (packaging fee) are never discountable.
//   - Money is computed in whole centavos and rounded to 2 decimals.
import { isOrderCharge } from './categories.ts'

// The business is NOT VAT-registered: the discount is a flat 20% with no VAT
// computation. Flip to true only once registered — that enables the
// VAT-exempt formula below (price ÷ 1.12, then 20% off).
export const IS_VAT_REGISTERED = false

export const DISCOUNT_RATE_PERCENT = 20

export type DiscountType = 'senior' | 'pwd'
export type IdType = 'osca' | 'gov_id' | 'pwd_id'
export type DiscountMode = 'items' | 'shared'

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = { senior: 'Senior Citizen', pwd: 'PWD' }
export const ID_TYPE_LABELS: Record<IdType, string> = { osca: 'OSCA ID', gov_id: 'Other government ID', pwd_id: 'PWD ID' }
// The IDs each discount type may be proven with, first = the default. A
// Senior Citizen may show an OSCA ID or any valid government ID (passport,
// driver's license, UMID…); PWD needs a PWD ID. Mirrored by the
// sale_discounts_id_matches_type constraint in the database.
export const ID_TYPES_FOR: Record<DiscountType, IdType[]> = { senior: ['osca', 'gov_id'], pwd: ['pwd_id'] }

export interface CartLine {
  id: string
  name: string
  price: number
  quantity: number
  addOns?: { name: string; price?: number }[]
}

// Units of one cart line assigned to a person (item mode only).
export interface AssignedUnits {
  lineId: string
  qty: number
}

export interface DiscountPerson {
  type: DiscountType | ''
  fullName: string
  idType: IdType | ''
  idNumber: string
  idVerified: boolean
  items?: AssignedUnits[]
}

export interface CoveredItem {
  lineId: string
  name: string
  qty: number
  unitPrice: number
  amount: number
}

export interface SharedCoverage {
  diners: number
  shareOf: number // the eligible total the share was cut from
}

export interface PersonDiscount {
  person: DiscountPerson
  covered: CoveredItem[] | SharedCoverage
  gross: number
  discount: number
  net: number
}

export interface OrderDiscount {
  ok: boolean
  errors: string[]
  mode: DiscountMode
  orderGross: number // whole bill, packaging fee included
  discountTotal: number
  orderNet: number // what the customer pays
  people: PersonDiscount[]
}

const toCentavos = (pesos: number) => Math.round((Number(pesos) || 0) * 100)
const toPesos = (centavos: number) => centavos / 100

export function roundMoney(pesos: number): number {
  return toPesos(toCentavos(pesos))
}

function unitPriceCentavos(line: CartLine): number {
  return toCentavos(line.price) + (line.addOns || []).reduce((sum, a) => sum + toCentavos(a.price || 0), 0)
}

// The discount on one person's eligible amount, in centavos.
export function discountCentavosFor(grossCentavos: number, vatRegistered: boolean = IS_VAT_REGISTERED): number {
  if (vatRegistered) {
    // ── VAT-EXEMPT FORMULA — DISABLED (IS_VAT_REGISTERED = false) ──────────
    // For a VAT-registered business the SC/PWD sale is VAT-exempt: strip the
    // 12% VAT first, then take 20% off the VAT-exclusive price. The discount
    // shown is everything removed (VAT + 20%). Not applied today.
    const vatExclusive = Math.round(grossCentavos / 1.12)
    const net = vatExclusive - Math.round((vatExclusive * DISCOUNT_RATE_PERCENT) / 100)
    return grossCentavos - net
  }
  return Math.round((grossCentavos * DISCOUNT_RATE_PERCENT) / 100)
}

// Normalized for duplicate checks: "1234-5678 " and "12345678" are the same ID.
function idNumberKey(person: DiscountPerson): string {
  return `${person.idType}:${person.idNumber.replace(/[\s-]/g, '').toUpperCase()}`
}

// Required details before a discount may be applied. Empty array = complete.
export function personErrors(person: DiscountPerson): string[] {
  const errors: string[] = []
  if (person.type !== 'senior' && person.type !== 'pwd') errors.push('Choose Senior Citizen or PWD.')
  if (!person.fullName.trim()) errors.push('Full name is required.')
  if (!person.idType || !(person.idType in ID_TYPE_LABELS)) errors.push('ID type is required.')
  else if (person.type && !ID_TYPES_FOR[person.type].includes(person.idType)) {
    errors.push(`${DISCOUNT_TYPE_LABELS[person.type]} needs: ${ID_TYPES_FOR[person.type].map(t => ID_TYPE_LABELS[t]).join(' or ')}.`)
  }
  if (!person.idNumber.trim()) errors.push('ID number is required.')
  if (!person.idVerified) errors.push('Tick "ID verified" after checking the ID.')
  return errors
}

// The whole order's SC/PWD discount. `ok: false` means the discount must not
// be applied yet (errors say why); the amounts are still filled in for
// whatever could be computed, so the cashier sees a live preview.
export function computeOrderDiscount({
  cart,
  mode,
  people,
  diners = 0,
  vatRegistered = IS_VAT_REGISTERED,
}: {
  cart: CartLine[]
  mode: DiscountMode
  people: DiscountPerson[]
  diners?: number
  vatRegistered?: boolean
}): OrderDiscount {
  const errors: string[] = []
  const orderGrossC = cart.reduce((sum, line) => sum + unitPriceCentavos(line) * line.quantity, 0)
  const eligibleLines = cart.filter(line => !isOrderCharge(line))
  const eligibleC = eligibleLines.reduce((sum, line) => sum + unitPriceCentavos(line) * line.quantity, 0)
  const label = (i: number) => (people.length > 1 ? `Person ${i + 1}: ` : '')

  people.forEach((person, i) => personErrors(person).forEach(e => errors.push(label(i) + e)))

  const seenIds = new Set<string>()
  people.forEach((person, i) => {
    if (!person.idNumber.trim() || !person.idType) return
    const key = idNumberKey(person)
    if (seenIds.has(key)) errors.push(`${label(i)}This ID is already used in this order — one discount per person.`)
    seenIds.add(key)
  })

  const results: { person: DiscountPerson; covered: CoveredItem[] | SharedCoverage; grossC: number }[] = []

  if (mode === 'items') {
    const assignedPerLine = new Map<string, number>()
    people.forEach((person, i) => {
      const covered: CoveredItem[] = []
      for (const unit of person.items || []) {
        if (!unit.qty) continue
        const line = cart.find(l => l.id === unit.lineId)
        if (!line) {
          errors.push(`${label(i)}An assigned item is no longer in the cart.`)
          continue
        }
        if (isOrderCharge(line)) {
          errors.push(`${label(i)}${line.name} can't be discounted.`)
          continue
        }
        if (!Number.isInteger(unit.qty) || unit.qty < 0) {
          errors.push(`${label(i)}Invalid quantity for ${line.name}.`)
          continue
        }
        assignedPerLine.set(line.id, (assignedPerLine.get(line.id) || 0) + unit.qty)
        const unitC = unitPriceCentavos(line)
        covered.push({ lineId: line.id, name: line.name, qty: unit.qty, unitPrice: toPesos(unitC), amount: toPesos(unitC * unit.qty) })
      }
      if (covered.length === 0) errors.push(`${label(i)}Select at least one item for this person.`)
      results.push({ person, covered, grossC: covered.reduce((sum, c) => sum + toCentavos(c.amount), 0) })
    })
    for (const [lineId, qty] of assignedPerLine) {
      const line = cart.find(l => l.id === lineId)!
      if (qty > line.quantity) errors.push(`${line.name}: ${qty} assigned but only ${line.quantity} in the order.`)
    }
  } else {
    if (people.length > 0) {
      if (!Number.isInteger(diners) || diners < 1) errors.push('Enter the number of diners.')
      else if (people.length > diners) errors.push(`${people.length} SC/PWD customers but only ${diners} diners.`)
      if (eligibleC === 0) errors.push('Nothing in this order can be discounted.')
    }
    const shareC = Number.isInteger(diners) && diners >= 1 ? Math.round(eligibleC / diners) : 0
    people.forEach(person => {
      results.push({ person, covered: { diners, shareOf: toPesos(eligibleC) }, grossC: shareC })
    })
  }

  const peopleOut: PersonDiscount[] = results.map(r => {
    const discountC = discountCentavosFor(r.grossC, vatRegistered)
    return { person: r.person, covered: r.covered, gross: toPesos(r.grossC), discount: toPesos(discountC), net: toPesos(r.grossC - discountC) }
  })
  const discountTotalC = peopleOut.reduce((sum, p) => sum + toCentavos(p.discount), 0)

  return {
    ok: errors.length === 0,
    errors,
    mode,
    orderGross: toPesos(orderGrossC),
    discountTotal: toPesos(discountTotalC),
    orderNet: toPesos(orderGrossC - discountTotalC),
    people: peopleOut,
  }
}

// No stacking: an order gets ONE discount — whichever is higher. SC/PWD is
// the only discount today, so `promoDiscount` is always 0; when a promo is
// added, Checkout passes its amount here and applies only the winner.
export function pickHigherDiscount(scPwdDiscount: number, promoDiscount = 0): 'sc_pwd' | 'promo' | 'none' {
  if (scPwdDiscount <= 0 && promoDiscount <= 0) return 'none'
  return promoDiscount > scPwdDiscount ? 'promo' : 'sc_pwd'
}

// On-screen display of an ID number: last 4 characters only.
export function maskIdNumber(idNumber: string | null | undefined): string {
  const value = (idNumber || '').trim()
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`
}
