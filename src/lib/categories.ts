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
export const DRINK_CATEGORIES = new Set(['Coffee', 'Tea', 'Drinks', 'Matcha', 'Refreshers', 'Frappe', 'Milk Series', 'Slushy Coconut', 'Milk'])
export const PASTRY_FOOD_CATEGORIES = new Set(['Pastry', 'Food', 'Nasi Goreng', 'Main Dish', 'Burgers', 'Pasta', 'Appetizers', 'Egg Brûlée'])
