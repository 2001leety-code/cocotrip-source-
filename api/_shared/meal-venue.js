// Conservative candidate eligibility, not dietary certification or opening verification.
// Cafe/bakery listings need separate full-meal evidence before they can fill lunch/dinner.
export function canServeMeal(row) {
  if (!row || row.cafe_not_meal === true || row._blockMealRole === 'cafe' || row.category === 'cafe') return false;
  const description = [row.type, row.category, row.cuisine, row.name, row.nameEn, row.display_name].filter(Boolean).join(' ');
  if (!/coffee|caf[eé]|dessert|bakery|카페|커피|디저트|베이커리|喫茶|咖啡/i.test(description)) return true;
  const evidence = row.meal_service_evidence;
  return evidence?.serves_full_meals === true && !!evidence.source_url && !!evidence.checked_at;
}
