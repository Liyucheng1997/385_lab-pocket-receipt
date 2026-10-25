// 内置分类：id 也是识别接口的取值范围，名称走 i18n（cat.<id>）
export const CATEGORIES = {
  expense: [
    { id: 'food', icon: 'utensils' },
    { id: 'snack', icon: 'coffee' },
    { id: 'shopping', icon: 'bag' },
    { id: 'daily', icon: 'package' },
    { id: 'transport', icon: 'car' },
    { id: 'housing', icon: 'home' },
    { id: 'utilities', icon: 'zap' },
    { id: 'telecom', icon: 'phone' },
    { id: 'entertainment', icon: 'film' },
    { id: 'clothing', icon: 'shirt' },
    { id: 'beauty', icon: 'sparkles' },
    { id: 'medical', icon: 'medical' },
    { id: 'education', icon: 'book' },
    { id: 'travel', icon: 'plane' },
    { id: 'sports', icon: 'dumbbell' },
    { id: 'social', icon: 'users' },
    { id: 'pets', icon: 'paw' },
    { id: 'other', icon: 'more' },
  ],
  income: [
    { id: 'salary', icon: 'wallet' },
    { id: 'bonus', icon: 'award' },
    { id: 'investment', icon: 'trending' },
    { id: 'parttime', icon: 'briefcase' },
    { id: 'gift', icon: 'gift' },
    { id: 'refund', icon: 'refund' },
    { id: 'other_income', icon: 'more' },
  ],
};

const ALL = new Map([...CATEGORIES.expense, ...CATEGORIES.income].map((c) => [c.id, c]));

export function getCategory(id) {
  return ALL.get(id) || ALL.get('other');
}

export function categoryIds() {
  return { expense: CATEGORIES.expense.map((c) => c.id), income: CATEGORIES.income.map((c) => c.id) };
}

export function defaultCategory(type) {
  return type === 'income' ? 'salary' : 'food';
}

export function isCategoryOfType(id, type) {
  return CATEGORIES[type].some((c) => c.id === id);
}
