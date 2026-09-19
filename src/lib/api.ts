import { supabase } from './supabase'

const LOW_STOCK_THRESHOLD = 15

// The `emoji` column is the historical name from the agreed schema; the
// product form now uploads a photo (base64 data URL) into it instead of a
// literal emoji character. `image` is the field name the UI works with.
function mapProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    category: row.category,
    stock: row.stock,
    image: row.emoji || '',
    imageSize: row.image_size ?? 100,
    costPrice: Number(row.cost_price) || 0,
    description: row.description || '',
    kind: row.kind || 'product',
    unit: row.unit || '',
  }
}

export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return data.map(mapProductRow)
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
  }
  const { data, error } = await supabase.from('products').insert(payload).select().single()
  if (error) throw error
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
  }
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single()
  if (error) throw error
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

export async function updateProductStock(id, previousStock, newStock) {
  const { error: updateError } = await supabase.from('products').update({ stock: newStock }).eq('id', id)
  if (updateError) throw updateError

  const { error: logError } = await supabase
    .from('stock_adjustments')
    .insert({ product_id: id, previous_stock: previousStock, new_stock: newStock })
  if (logError) throw logError
}

export async function recordSale({ customerName, items, total, paymentMethod, amountReceived, changeGiven, orderType, note }) {
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      customer_name: customerName || null,
      total,
      payment_method: paymentMethod,
      amount_received: paymentMethod === 'cash' ? amountReceived : null,
      change_given: paymentMethod === 'cash' ? changeGiven : null,
      order_type: orderType || null,
      note: note?.trim() || null,
    })
    .select()
    .single()
  if (saleError) throw saleError

  const lineItems = items.map(i => ({
    sale_id: sale.id,
    product_id: i.id,
    product_name: i.name,
    quantity: i.qty,
    unit_price: i.price,
  }))
  const { error: itemsError } = await supabase.from('sale_items').insert(lineItems)
  if (itemsError) throw itemsError

  // Decrement stock per purchased product. Fetch-then-update rather than a
  // blind decrement so we never write a stale value; not fully atomic under
  // concurrent checkouts, but this app runs from a single POS terminal.
  for (const i of items) {
    const { data: current, error: fetchErr } = await supabase.from('products').select('stock').eq('id', i.id).single()
    if (fetchErr) throw fetchErr
    const newStock = Math.max(0, current.stock - i.qty)
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', i.id)
    if (stockErr) throw stockErr
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
    .select('id, customer_name, total, created_at, sale_items(quantity)')
    .gte('created_at', start.toISOString())
    .neq('status', 'voided')
    .order('created_at', { ascending: false })
  if (error) throw error

  return data.map(sale => ({
    id: sale.id,
    customer_name: sale.customer_name,
    total: Number(sale.total),
    created_at: sale.created_at,
    itemCount: (sale.sale_items || []).reduce((sum, i) => sum + i.quantity, 0),
  }))
}

// Reports: all-time sales (for monthly chart + this-month summary stats, and
// the transaction list). Includes voided sales — callers filter those out of
// revenue/analytics but still need them to render the list with a status.
export async function fetchAllSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('id, customer_name, total, payment_method, order_type, note, created_at, status, voided_at, voided_by, edited_at, edited_by, amount_received, change_given')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map(s => ({
    ...s,
    total: Number(s.total),
    amount_received: s.amount_received != null ? Number(s.amount_received) : null,
    change_given: s.change_given != null ? Number(s.change_given) : null,
  }))
}

// Reports: permanently deletes all transaction history. sale_items are
// removed first since they carry a foreign key to sales. .select('id') on
// each delete makes a silently-blocked delete (e.g. an RLS policy gap)
// surface as a real error instead of resolving as if it had succeeded —
// this table previously had no DELETE policy at all, so the request
// matched zero rows and returned no error.
export async function clearAllSales() {
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
  const { error: itemsError } = await supabase.from('sale_items').delete().neq('sale_id', ZERO_UUID).select('id')
  if (itemsError) throw itemsError

  const { data: deletedSales, error: salesError } = await supabase.from('sales').delete().neq('id', ZERO_UUID).select('id')
  if (salesError) throw salesError
  if (!deletedSales || deletedSales.length === 0) {
    throw new Error('Transactions were not cleared — you may not have permission')
  }
}

// Reports: all-time sale line items joined to product category + cost (for
// Top Products, Category Breakdown, COGS/profit, and the transaction list's
// per-order item detail). sale_id/product_id let callers exclude voided
// sales' items from analytics and restore stock on void/edit.
export async function fetchAllSaleItemsWithCategory() {
  const { data, error } = await supabase.from('sale_items').select('sale_id, product_id, product_name, quantity, unit_price, products(category, cost_price)')
  if (error) throw error
  return data.map(item => ({
    saleId: item.sale_id,
    productId: item.product_id,
    name: item.product_name,
    qty: item.quantity,
    price: Number(item.unit_price),
    category: item.products?.category || 'Uncategorized',
    // Cost as of now, not at time of sale — the schema doesn't snapshot
    // historical cost, so this is today's cost_price applied retroactively.
    cost: Number(item.products?.cost_price) || 0,
  }))
}

// Reports: reverses a completed sale — restores stock for each line item and
// marks the sale voided (kept for audit, excluded from revenue/analytics)
// rather than deleting it.
export async function voidSale(saleId, voidedBy) {
  const { data: lineItems, error: itemsError } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId)
  if (itemsError) throw itemsError

  for (const item of lineItems) {
    if (!item.product_id) continue // product was deleted since the sale — nothing to restore stock to
    const { data: product, error: fetchErr } = await supabase.from('products').select('stock').eq('id', item.product_id).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!product) continue
    const newStock = product.stock + item.quantity
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id)
    if (stockErr) throw stockErr
    const { error: logError } = await supabase
      .from('stock_adjustments')
      .insert({ product_id: item.product_id, previous_stock: product.stock, new_stock: newStock })
    if (logError) throw logError
  }

  const { data, error } = await supabase
    .from('sales')
    .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: voidedBy })
    .eq('id', saleId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Transaction was not voided — you may not have permission')
  }
}

// Reports: replaces a sale's line items and totals, adjusting stock by the
// difference between old and new quantities per product, and stamping who
// edited it and when so the record shows it's no longer the original.
export async function editSale(saleId, { items, paymentMethod, amountReceived, changeGiven, editedBy }) {
  const { data: oldItems, error: oldItemsError } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId)
  if (oldItemsError) throw oldItemsError

  const oldQtyByProduct = new Map()
  oldItems.forEach(i => {
    if (i.product_id) oldQtyByProduct.set(i.product_id, (oldQtyByProduct.get(i.product_id) || 0) + i.quantity)
  })
  const newQtyByProduct = new Map()
  items.forEach(i => {
    if (i.productId) newQtyByProduct.set(i.productId, (newQtyByProduct.get(i.productId) || 0) + i.qty)
  })

  const productIds = new Set([...oldQtyByProduct.keys(), ...newQtyByProduct.keys()])
  for (const productId of productIds) {
    const delta = (oldQtyByProduct.get(productId) || 0) - (newQtyByProduct.get(productId) || 0)
    if (delta === 0) continue
    const { data: product, error: fetchErr } = await supabase.from('products').select('stock').eq('id', productId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!product) continue // product was deleted since the sale
    const newStock = Math.max(0, product.stock + delta)
    const { error: stockErr } = await supabase.from('products').update({ stock: newStock }).eq('id', productId)
    if (stockErr) throw stockErr
    const { error: logError } = await supabase
      .from('stock_adjustments')
      .insert({ product_id: productId, previous_stock: product.stock, new_stock: newStock })
    if (logError) throw logError
  }

  const { error: deleteError } = await supabase.from('sale_items').delete().eq('sale_id', saleId)
  if (deleteError) throw deleteError

  const newTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0)
  if (items.length > 0) {
    const lineItems = items.map(i => ({
      sale_id: saleId,
      product_id: i.productId || null,
      product_name: i.name,
      quantity: i.qty,
      unit_price: i.price,
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
