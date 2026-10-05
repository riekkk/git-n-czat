// The one rule for which sales count toward any revenue/analytics figure
// (Reports, Dashboard, Customers, exports). Voided sales stay in the data —
// Transaction History still lists them as VOIDED — and staff orders have
// their own log, but neither ever counts. Every report filters through
// these instead of re-checking `status`/`is_staff_order` inline, so a new
// report can't forget one of the two.

interface SaleLike {
  id?: string
  status?: string | null
  is_staff_order?: boolean | null
}

export function isVoidedSale(sale: SaleLike | null | undefined): boolean {
  return sale?.status === 'voided'
}

export function countsTowardReports(sale: SaleLike | null | undefined): boolean {
  return !!sale && !isVoidedSale(sale) && !sale.is_staff_order
}

// Sale lines belonging to the given sales only. An allowlist on purpose: a
// line whose sale isn't in `sales` (voided, staff, filtered out, or simply
// not loaded) is left out rather than counted by default.
export function linesOfSales<T extends { saleId?: string }>(lines: T[], sales: SaleLike[]): T[] {
  const ids = new Set(sales.map(s => s.id))
  return lines.filter(line => ids.has(line.saleId))
}
