import { supabase } from './supabase'
import { isOrderCharge } from './categories'
import { countsTowardReports } from './salesFilters'
import type { OrderDiscount } from './discounts.ts'

const LOW_STOCK_THRESHOLD = 15

// Sum of an item's selected add-ons' prices — used wherever a line total
// needs to reflect add-ons (billable, unlike the free-text note).
function addOnsCost(item) {
  return (item.addOns || []).reduce((sum, a) => sum + (a.price || 0), 0)
}

// The `emoji` column is the historical name from the agreed schema; the
// product form now uploads a photo (base64 data URL) into it instead of a
// literal emoji character. `image` is the field name the UI works with.
function mapProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    category: row.category,
    // numeric columns come back from PostgREST as strings (arbitrary
    // precision, no silent float rounding) — Number() them like price/cost
    // above, or comparisons like stock === 0 and arithmetic elsewhere break.
    stock: Number(row.stock),
    image: row.emoji || '',
    imageSize: row.image_size ?? 100,
    costPrice: Number(row.cost_price) || 0,
    description: row.description || '',
    kind: row.kind || 'product',
    unit: row.unit || '',
    // Ingredients only: how many servings one stock unit yields (e.g. a 1L
    // bottle of Milk yielding 20 lattes' worth) — see product_recipes.
    yieldPerUnit: Number(row.yield_per_unit) || 1,
  }
}

// UI field → products column, for applying a partial realtime row (below).
const PRODUCT_FIELD_COLUMNS = {
  name: 'name', price: 'price', category: 'category', stock: 'stock', image: 'emoji',
  imageSize: 'image_size', costPrice: 'cost_price', description: 'description',
  kind: 'kind', unit: 'unit', yieldPerUnit: 'yield_per_unit',
}

// Applies one realtime INSERT/UPDATE row to the in-memory product list,
// touching only that product. Realtime can leave out large columns that
// didn't change (the base64 photo in `emoji`), so an update only overwrites
// fields actually present in the row — a stock change never blanks a photo.
export function applyProductChange(products, row) {
  const existing = products.find(p => p.id === row.id)
  if (!existing) return [...products, mapProductRow(row)]
  const mapped = mapProductRow(row)
  const patch = {}
  for (const [field, column] of Object.entries(PRODUCT_FIELD_COLUMNS)) {
    if (row[column] !== undefined) patch[field] = mapped[field]
  }
  return products.map(p => (p.id === row.id ? { ...p, ...patch } : p))
}

export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data.map(mapProductRow)
}

// Replaces a product's whole recipe (delete-then-insert, same pattern as
// editSale's line items) — called after the product itself is saved, since
// a fresh insert doesn't have an id to attach recipe rows to until then.
// `recipe` is [{ ingredientId, servings }]; undefined leaves recipes alone
// (e.g. saving an ingredient, which never has its own recipe).
async function saveProductRecipe(productId, recipe) {
  if (recipe === undefined) return
  const { error: deleteError } = await supabase.from('product_recipes').delete().eq('product_id', productId)
  if (deleteError) throw deleteError
  const rows = recipe
    .filter(r => r.ingredientId && r.servings > 0)
    .map(r => ({ product_id: productId, ingredient_id: r.ingredientId, servings: r.servings }))
  if (rows.length === 0) return
  const { error: insertError } = await supabase.from('product_recipes').insert(rows)
  if (insertError) throw insertError
}

export async function fetchProductRecipe(productId) {
  const { data, error } = await supabase.from('product_recipes').select('ingredient_id, servings').eq('product_id', productId)
  if (error) throw error
  return data.map(r => ({ ingredientId: r.ingredient_id, servings: Number(r.servings) }))
}

export async function insertProduct(item) {
  const payload = {
    name: item.name,
    price: item.price || 0,
    category: item.category,
    stock: item.stock || 0,
    emoji: item.image || '',
    image_size: item.imageSize ?? 100,
    cost_price: item.costPrice || 0,
    description: item.description || '',
    kind: item.kind || 'product',
    unit: item.unit || null,
    yield_per_unit: item.yieldPerUnit || 1,
  }
  const { data, error } = await supabase.from('products').insert(payload).select().single()
  if (error) throw error
  await saveProductRecipe(data.id, item.recipe)
  return mapProductRow(data)
}

export async function updateProduct(id, item) {
  const payload = {
    name: item.name,
    price: item.price || 0,
    category: item.category,
    stock: item.stock || 0,
    emoji: item.image || '',
    image_size: item.imageSize ?? 100,
    cost_price: item.costPrice || 0,
    description: item.description || '',
    unit: item.unit || null,
    yield_per_unit: item.yieldPerUnit || 1,
  }
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single()
  if (error) throw error
  await saveProductRecipe(id, item.recipe)
  return mapProductRow(data)
}

export async function deleteProduct(id) {
  // .select('id') makes a silently-blocked delete (e.g. an RLS policy gap)
  // surface as a real error instead of resolving as if it had succeeded.
  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Product was not deleted — you may not have permission')
  }
}

// Manual stock correction (Inventory screen quick-edit) — an explicit
// override of that one item's own count, not a sale/void/edit event, so it
// deliberately does NOT cascade through product_recipes (setting Spanish
// Latte's stock to 5 shouldn't also touch Milk).
export async function updateProductStock(id, previousStock, newStock) {
  const { error: updateError } = await supabase.from('products').update({ stock: newStock }).eq('id', id)
  if (updateError) throw updateError

  const { error: logError } = await supabase
    .from('stock_adjustments')
    .insert({ product_id: id, previous_stock: previousStock, new_stock: newStock })
  if (logError) throw logError
}

// Cascades a product's own stock change through its recipe (product_recipes)
// into ingredient stock. `productQtyDelta` uses the same sign as the
// caller's own product-stock change (negative = sold/consumed, positive =
// restored) — passed straight through, so ingredient stock moves the same
// direction. No-ops for a product with no recipe (e.g. an ingredient, or a
// product nobody's built a recipe for yet).
async function applyRecipeStockDelta(productId, productQtyDelta) {
  if (!productQtyDelta) return
  const { data: recipeRows, error: recipeErr } = await supabase
    .from('product_recipes')
    .select('ingredient_id, servings')
    .eq('product_id', productId)
  if (recipeErr) throw recipeErr
  if (!recipeRows || recipeRows.length === 0) return

  for (const row of recipeRows) {
    const { data: ingredient, error: fetchErr } = await supabase
      .from('products')
      .select('stock, yield_per_unit')
      .eq('id', row.ingredient_id)
      .maybeSingle()
    if (fetchErr) throw fetchErr
    if (!ingredient) continue // ingredient was deleted since the recipe was set
    const yieldPerUnit = Number(ingredient.yield_per_unit) || 1
    const stockDelta = (Number(row.servings) * productQtyDelta) / yieldPerUnit
    const newIngredientStock = Math.max(0, Number(ingredient.stock) + stockDelta)
    const { error: stockErr } = await supabase.from('products').update({ stock: newIngredientStock }).eq('id', row.ingredient_id)
    if (stockErr) throw stockErr
  }
}

// `discount` (optional) is an OrderDiscount from computeOrderDiscount with
// ok: true — `total` is then its net. Its per-person records are written
// right after the sale row, before any line item or stock change, so if
// that insert fails the sale is voided straight away (nothing to restore
// yet) rather than left looking discounted with no record of who for.
export async function recordSale({ customerName, items, total, paymentMethod, amountReceived, changeGiven, orderType, isStaffOrder, discount = null as OrderDiscount | null }) {
  const hasDiscount = !isStaffOrder && !!discount && discount.people.length > 0
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      customer_name: customerName || null,
      total,
      payment_method: isStaffOrder ? 'staff' : paymentMethod,
      amount_received: paymentMethod === 'cash' ? amountReceived : null,
      change_given: paymentMethod === 'cash' ? changeGiven : null,
      order_type: orderType || null,
      is_staff_order: !!isStaffOrder,
      gross_total: hasDiscount ? discount!.orderGross : null,
      discount_total: hasDiscount ? discount!.discountTotal : null,
    })
    .select()
    .single()
  if (saleError) throw saleError

  if (hasDiscount && discount) {
    // cashier is stamped by the database from the signed-in account.
    const { error: discountError } = await supabase.from('sale_discounts').insert(discount.people.map(p => ({
      sale_id: sale.id,
      discount_type: p.person.type,
      full_name: p.person.fullName.trim(),
      id_type: p.person.idType,
      id_number: p.person.idNumber.trim(),
      id_verified: p.person.idVerified,
      mode: discount.mode,
      covered: p.covered,
      gross: p.gross,
      discount: p.discount,
      net: p.net,
    })))
    if (discountError) {
      await supabase.from('sales').update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: 'system: SC/PWD record failed' }).eq('id', sale.id)
      throw new Error(`The SC/PWD discount details couldn't be saved, so the sale was not recorded — try again. (${discountError.message})`)
    }
  }

  const lineItems = items.map(i => ({
    sale_id: sale.id,
    product_id: i.id,
    product_name: i.name,
    quantity: i.qty,
    unit_price: i.price,
    note: i.note?.trim() || null,
    add_ons: (i.addOns || []).map(a => ({ productId: a.productId || null, name: a.name, price: a.price || 0 })),
  }))
  const { error: itemsError } = await supabase.from('sale_items').insert(lineItems)
  if (itemsError) throw itemsError

  // Decrement stock per purchased product, and per add-on product used (one
  // add-on unit per parent unit ordered — a line quantity of 3 with an
  // "Extra Shot" add-on uses 3 shots). Fetch-then-update rather than a blind
  // decrement so we never write a stale value; not fully atomic under
  // concurrent checkouts, but this app runs from a single POS terminal.
  // Each deduction also cascades through that product's recipe (if any)
  // into ingredient stock — see applyRecipeStockDelta. Order-level charges
  // (packaging fee) are skipped entirely — they're not stock (isOrderCharge).
  for (const i of items) {
    if (isOrderCharge(i)) continue
    const { data: current, error: fetchErr } = await supabase.from('products').select('stock').eq('id', i.id).single()
    if (fetchErr) throw fetchErr
    // numeric columns come back as strings — Number() before arithmetic.
    const newStock = Math.max(0, Number(current.stock) - i.qty)
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', i.id)
    if (stockErr) throw stockErr
    await applyRecipeStockDelta(i.id, -i.qty)

    for (const addOn of i.addOns || []) {
      if (!addOn.productId) continue // free-text custom add-on — no stock effect
      const { data: addOnProduct, error: aFetchErr } = await supabase.from('products').select('stock').eq('id', addOn.productId).maybeSingle()
      if (aFetchErr) throw aFetchErr
      if (!addOnProduct) continue
      const addOnNewStock = Math.max(0, Number(addOnProduct.stock) - i.qty)
      const { error: aStockErr } = await supabase.from('products').update({ stock: addOnNewStock }).eq('id', addOn.productId)
      if (aStockErr) throw aStockErr
      await applyRecipeStockDelta(addOn.productId, -i.qty)
    }
  }

  return sale
}

// Audit trail for the standalone "Open Cash Drawer" button — separate from
// the transaction log since opening the drawer this way doesn't create a
// sale. Best-effort: callers shouldn't block or fail the drawer opening
// (which has already physically happened) if only the log insert fails.
export async function logDrawerOpen(openedBy) {
  const { error } = await supabase.from('drawer_openings').insert({ opened_by: openedBy || null })
  if (error) throw error
}

export async function fetchLowStockCount(threshold = LOW_STOCK_THRESHOLD) {
  const { count, error } = await supabase.from('products').select('id', { count: 'exact', head: true }).lt('stock', threshold)
  if (error) throw error
  return count || 0
}

// Dashboard: one query covers "today" stats + the last-7-days chart.
export async function fetchRecentSales(daysBack = 7) {
  const start = new Date()
  start.setDate(start.getDate() - (daysBack - 1))
  start.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('sales')
    .select('id, customer_name, total, created_at, status, is_staff_order, sale_items(product_name, quantity)')
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error

  // Filtered here with the shared rule rather than in the query, so the
  // Dashboard can never disagree with Reports about what counts.
  return data.filter(countsTowardReports).map(sale => ({
    id: sale.id,
    customer_name: sale.customer_name,
    total: Number(sale.total),
    created_at: sale.created_at,
    itemCount: (sale.sale_items || []).filter(i => !isOrderCharge({ name: i.product_name })).reduce((sum, i) => sum + i.quantity, 0),
  }))
}

// Supabase/PostgREST caps a single response at 1000 rows by default — an
// unbounded .select() past that silently truncates instead of erroring, so
// callers that need every row (not just a page of them) must paginate with
// .range() instead. orderColumns must fully determine a unique row order
// (a tiebreaker like id after created_at) or rows can be skipped/duplicated
// across page boundaries.
// A non-literal select string defeats supabase-js's column-shape type
// inference (it falls back to an opaque stub type) — declared any[] here to
// match this file's existing loosely-typed rows rather than fight that.
async function fetchAllRows(table: string, selectClause: string, orderColumns: [string, { ascending: boolean }][], filter: (query: any) => any = q => q): Promise<any[]> {
  const PAGE_SIZE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = filter(supabase.from(table).select(selectClause)).range(from, from + PAGE_SIZE - 1) as any
    for (const [column, options] of orderColumns) query = query.order(column, options)
    const { data, error } = await query
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

// Reports: all-time sales (for monthly chart + this-month summary stats, and
// the transaction list). Includes voided sales — callers filter those out of
// revenue/analytics but still need them to render the list with a status.
export async function fetchAllSales() {
  const data = await fetchAllRows(
    'sales',
    'id, customer_name, total, gross_total, discount_total, payment_method, order_type, is_staff_order, created_at, status, voided_at, voided_by, edited_at, edited_by, amount_received, change_given',
    [['created_at', { ascending: true }], ['id', { ascending: true }]]
  )
  return data.map(s => ({
    ...s,
    total: Number(s.total),
    // NULL on every sale without an SC/PWD discount (all sales before it existed).
    gross_total: s.gross_total != null ? Number(s.gross_total) : null,
    discount_total: s.discount_total != null ? Number(s.discount_total) : null,
    amount_received: s.amount_received != null ? Number(s.amount_received) : null,
    change_given: s.change_given != null ? Number(s.change_given) : null,
  }))
}

function mapSaleDiscountRow(row) {
  return {
    id: row.id,
    saleId: row.sale_id,
    createdAt: row.created_at,
    cashier: row.cashier,
    type: row.discount_type,
    fullName: row.full_name,
    idType: row.id_type,
    idNumber: row.id_number,
    idVerified: row.id_verified,
    mode: row.mode,
    covered: row.covered,
    gross: Number(row.gross),
    discount: Number(row.discount),
    net: Number(row.net),
  }
}

// One sale's SC/PWD records (receipt reprints). Empty for undiscounted sales.
export async function fetchSaleDiscounts(saleId) {
  const { data, error } = await supabase.from('sale_discounts').select('*').eq('sale_id', saleId).order('created_at', { ascending: true })
  if (error) throw error
  return data.map(mapSaleDiscountRow)
}

// SC/PWD Discount Log: every discounted person in [fromIso, toIso), newest
// first, optionally one discount type. Voided sales are dropped with the
// shared countsTowardReports rule, like every other report.
export async function fetchDiscountLog({ fromIso, toIso, type = 'all' }: { fromIso: string; toIso: string; type?: string }) {
  const data = await fetchAllRows(
    'sale_discounts',
    '*, sales(status, is_staff_order, total)',
    [['created_at', { ascending: false }], ['id', { ascending: true }]],
    q => {
      let query = q.gte('created_at', fromIso).lt('created_at', toIso)
      if (type !== 'all') query = query.eq('discount_type', type)
      return query
    }
  )
  return data.filter(row => countsTowardReports(row.sales)).map(mapSaleDiscountRow)
}

// Reports: all-time sale line items joined to product category + cost (for
// Top Products, Category Breakdown, COGS/profit, and the transaction list's
// per-order item detail). sale_id/product_id let callers exclude voided
// sales' items from analytics and restore stock on void/edit. note is the
// per-item special-instruction text entered at Checkout (e.g. "less ice").
export async function fetchAllSaleItemsWithCategory() {
  const data = await fetchAllRows(
    'sale_items',
    'sale_id, product_id, product_name, quantity, unit_price, note, add_ons, products(category, cost_price)',
    [['id', { ascending: true }]]
  )
  return data.map(item => ({
    saleId: item.sale_id,
    productId: item.product_id,
    name: item.product_name,
    qty: item.quantity,
    price: Number(item.unit_price),
    note: item.note || '',
    addOns: item.add_ons || [],
    category: item.products?.category || 'Uncategorized',
    // Cost as of now, not at time of sale — the schema doesn't snapshot
    // historical cost, so this is today's cost_price applied retroactively.
    cost: Number(item.products?.cost_price) || 0,
  }))
}

// Reports: reverses a completed sale — marks it voided (kept for audit,
// excluded from revenue/analytics) and restores stock for each line item.
//
// The sale is marked voided FIRST, and only if it isn't already: if two
// devices void the same sale, or a void is retried after an error, only the
// one that flips the status restores stock — never twice. (Restoring first
// meant a failure partway left the sale still counted in every report,
// with its stock already put back, and a retry restored it again.)
export async function voidSale(saleId, voidedBy) {
  const { data: marked, error: markError } = await supabase
    .from('sales')
    .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: voidedBy })
    .eq('id', saleId)
    .neq('status', 'voided')
    .select('id')
  if (markError) throw markError
  if (!marked || marked.length === 0) {
    const { data: current } = await supabase.from('sales').select('status').eq('id', saleId).maybeSingle()
    if (current?.status === 'voided') throw new Error('This transaction is already voided.')
    throw new Error('Transaction was not voided — you may not have permission')
  }

  const { data: lineItems, error: itemsError } = await supabase
    .from('sale_items')
    .select('product_id, product_name, quantity, add_ons')
    .eq('sale_id', saleId)
  if (itemsError) throw itemsError

  const restoreStock = async (productId, qty) => {
    const { data: product, error: fetchErr } = await supabase.from('products').select('stock').eq('id', productId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!product) return // product was deleted since the sale — nothing to restore stock to
    // numeric columns come back as strings — Number() before arithmetic, or
    // "12" + 3 silently string-concatenates into "123" instead of adding.
    const previousStock = Number(product.stock)
    const newStock = previousStock + qty
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', productId)
    if (stockErr) throw stockErr
    const { error: logError } = await supabase
      .from('stock_adjustments')
      .insert({ product_id: productId, previous_stock: previousStock, new_stock: newStock })
    if (logError) throw logError
    await applyRecipeStockDelta(productId, qty)
  }

  try {
    for (const item of lineItems) {
      if (isOrderCharge({ name: item.product_name })) continue // never deducted, so nothing to restore
      if (item.product_id) await restoreStock(item.product_id, item.quantity)
      for (const addOn of item.add_ons || []) {
        if (addOn.productId) await restoreStock(addOn.productId, item.quantity)
      }
    }
  } catch (err) {
    // Supabase returns plain { message } objects, not Error instances.
    const detail = (err as { message?: string })?.message || String(err)
    throw new Error(`The sale was voided, but restoring its stock didn't finish — check Inventory counts for its items. (${detail})`)
  }
}

// Reports: permanently deletes a VOIDED sale and its lines in one database
// call (delete_voided_sale). The database checks the separate delete
// password (stored only as a salted hash, with a lockout after repeated
// wrong attempts) and refuses completed sales, staff orders, Inventory
// Staff and the Customer Display. Stock is not touched: the void already
// restored it. Nothing about the deleted sale is kept.
export async function deleteVoidedSale(saleId, deletePassword) {
  const { data, error } = await supabase.rpc('delete_voided_sale', { p_sale_id: saleId, p_password: deletePassword })
  if (error) throw new Error(error.message || 'The sale could not be deleted')
  if (!data?.ok) throw new Error(data?.error || 'The sale could not be deleted')
}

// Reports: replaces a sale's line items and totals, adjusting stock by the
// difference between old and new quantities per product, and stamping who
// edited it and when so the record shows it's no longer the original.
export async function editSale(saleId, { items, paymentMethod, amountReceived, changeGiven, editedBy }) {
  // An SC/PWD-discounted sale can't be edited (recomputing the total below
  // would drop the discount; the database refuses it too). Checked before
  // anything — stock included — is touched.
  const { data: current, error: currentError } = await supabase.from('sales').select('discount_total').eq('id', saleId).maybeSingle()
  if (currentError) throw currentError
  if (current?.discount_total != null) {
    throw new Error('This sale has an SC/PWD discount, so it can\'t be edited. Void it and ring it up again.')
  }

  const { data: oldItems, error: oldItemsError } = await supabase
    .from('sale_items')
    .select('product_id, product_name, quantity, add_ons')
    .eq('sale_id', saleId)
  if (oldItemsError) throw oldItemsError

  // Combines each line's own product with any add-on products it used (one
  // add-on unit per parent unit) into a single per-product quantity map, so
  // stock deltas below account for add-ons the same way as the base item.
  // Order-level charges (packaging fee) never touch stock, so they're left
  // out of both sides.
  const qtyByProduct = rows => {
    const map = new Map()
    rows.filter(row => !isOrderCharge(row)).forEach(row => {
      if (row.productId) map.set(row.productId, (map.get(row.productId) || 0) + row.qty)
      ;(row.addOns || []).forEach(addOn => {
        if (addOn.productId) map.set(addOn.productId, (map.get(addOn.productId) || 0) + row.qty)
      })
    })
    return map
  }
  const oldQtyByProduct = qtyByProduct(oldItems.map(i => ({ productId: i.product_id, name: i.product_name, qty: i.quantity, addOns: i.add_ons })))
  const newQtyByProduct = qtyByProduct(items.map(i => ({ productId: i.productId, name: i.name, qty: i.qty, addOns: i.addOns })))

  const productIds = new Set([...oldQtyByProduct.keys(), ...newQtyByProduct.keys()])
  for (const productId of productIds) {
    const delta = (oldQtyByProduct.get(productId) || 0) - (newQtyByProduct.get(productId) || 0)
    if (delta === 0) continue
    const { data: product, error: fetchErr } = await supabase.from('products').select('stock').eq('id', productId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!product) continue // product was deleted since the sale
    // numeric columns come back as strings — Number() before arithmetic.
    const previousStock = Number(product.stock)
    const newStock = Math.max(0, previousStock + delta)
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', productId)
    if (stockErr) throw stockErr
    const { error: logError } = await supabase
      .from('stock_adjustments')
      .insert({ product_id: productId, previous_stock: previousStock, new_stock: newStock })
    if (logError) throw logError
    await applyRecipeStockDelta(productId, delta)
  }

  const { error: deleteError } = await supabase.from('sale_items').delete().eq('sale_id', saleId)
  if (deleteError) throw deleteError

  const newTotal = items.reduce((sum, i) => sum + (i.price + addOnsCost(i)) * i.qty, 0)
  if (items.length > 0) {
    const lineItems = items.map(i => ({
      sale_id: saleId,
      product_id: i.productId || null,
      product_name: i.name,
      quantity: i.qty,
      unit_price: i.price,
      note: i.note?.trim() || null,
      add_ons: (i.addOns || []).map(a => ({ productId: a.productId || null, name: a.name, price: a.price || 0 })),
    }))
    const { error: insertError } = await supabase.from('sale_items').insert(lineItems)
    if (insertError) throw insertError
  }

  const { data, error } = await supabase
    .from('sales')
    .update({
      total: newTotal,
      payment_method: paymentMethod,
      amount_received: paymentMethod === 'cash' ? amountReceived : null,
      change_given: paymentMethod === 'cash' ? changeGiven : null,
      edited_at: new Date().toISOString(),
      edited_by: editedBy,
    })
    .eq('id', saleId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Transaction was not updated — you may not have permission')
  }
}

// Print Station — the PrintNode printer every device prints to, stored in
// app_settings so a switch reaches all devices at once (see printer.ts,
// which reads it before every job). Returns { printerId, label, updatedAt,
// updatedBy } or null if it has never been set.
export async function fetchPrintStation(signal?: AbortSignal) {
  let query = supabase.from('app_settings').select('value, updated_at, updated_by').eq('key', 'print_station') as any
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null
  return { printerId: Number(data.value?.printerId), label: data.value?.label || '', updatedAt: data.updated_at, updatedBy: data.updated_by }
}

export async function savePrintStation({ printerId, label }, updatedBy) {
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({ key: 'print_station', value: { printerId, label }, updated_at: new Date().toISOString(), updated_by: updatedBy || null })
    .select('key')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Print station was not saved — you may not have permission')
}
