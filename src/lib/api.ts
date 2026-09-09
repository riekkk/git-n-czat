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

export async function recordSale({ customerName, items, total, paymentMethod }) {
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({ customer_name: customerName || null, total, payment_method: paymentMethod })
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

// Reports: all-time sales (for monthly chart + this-month summary stats).
export async function fetchAllSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('id, customer_name, total, payment_method, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map(s => ({ ...s, total: Number(s.total) }))
}

// Reports: all-time sale line items joined to product category + cost (for
// Top Products, Category Breakdown, and COGS/profit).
export async function fetchAllSaleItemsWithCategory() {
  const { data, error } = await supabase.from('sale_items').select('product_name, quantity, unit_price, products(category, cost_price)')
  if (error) throw error
  return data.map(item => ({
    name: item.product_name,
    qty: item.quantity,
    price: Number(item.unit_price),
    category: item.products?.category || 'Uncategorized',
    // Cost as of now, not at time of sale — the schema doesn't snapshot
    // historical cost, so this is today's cost_price applied retroactively.
    cost: Number(item.products?.cost_price) || 0,
  }))
}
