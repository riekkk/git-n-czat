// Shared product-category classification, used by both the Reports
// breakdown (App.jsx) and receipt printing (printer.ts) so the two stay
// in sync — a category added to one without the other would silently
// misclassify sales/kitchen routing.
export const DRINK_CATEGORIES = new Set(['Coffee', 'Tea', 'Drinks'])
export const PASTRY_FOOD_CATEGORIES = new Set(['Pastry', 'Food'])
