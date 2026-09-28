// Shared product-category classification, used by both the Reports
// breakdown (App.jsx) and receipt printing (printer.ts) so the two stay
// in sync — a category added to one without the other would silently
// misclassify sales/kitchen routing (Kitchen/Barista copies never
// generating, reprint options never appearing, etc).
//
// These are matched against the free-text `category` field staff type on
// each product, so this list has to track the actual menu, not just the
// starter categories in SUGGESTED_CATEGORIES. Keep it in sync when a new
// menu category is added — a category missing from both sets here will
// silently never route to Kitchen or Barista.
export const DRINK_CATEGORIES = new Set(['Coffee', 'Tea', 'Drinks', 'Matcha', 'Refreshers', 'Frappe', 'Milk Series', 'Slushy Coconut', 'Milk', 'Drink Add-ons'])
export const PASTRY_FOOD_CATEGORIES = new Set(['Pastry', 'Food', 'Nasi Goreng', 'Main Dish', 'Burgers', 'Pasta', 'Appetizers', 'Egg Brûlée', 'Food Add-ons'])

// Order-level charges (e.g. the Take Out packaging fee) are rung up as
// ordinary products so they land in the sale total and sale_items like any
// other line — but they aren't menu items: they never print on a receipt,
// never route to Kitchen/Barista, never move stock, and are left out of
// item rankings (Top Products, Category Breakdown). Matched by name rather
// than id/category because sale_items only snapshots product_name, and
// this has to work for historical rows and reprints too.
const ORDER_CHARGE_NAMES = new Set(['packaging fee'])

export function isOrderCharge(item: { name?: string | null } | null | undefined): boolean {
  return !!item?.name && ORDER_CHARGE_NAMES.has(item.name.trim().toLowerCase())
}
