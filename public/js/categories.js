// 内置分类：id 也是识别接口的取值范围，名称走 i18n（cat.<id>），每个分类有自己的颜色
export const CATEGORIES = {
  expense: [
    { id: 'food', icon: 'utensils', color: '#ff8a3d' },
    { id: 'snack', icon: 'coffee', color: '#c98a4b' },
    { id: 'shopping', icon: 'bag', color: '#ff5c8a' },
    { id: 'daily', icon: 'package', color: '#3bb4c9' },
    { id: 'transport', icon: 'car', color: '#4a8cff' },
    { id: 'housing', icon: 'home', color: '#8b6cf0' },
    { id: 'utilities', icon: 'zap', color: '#f0a800' },
    { id: 'telecom', icon: 'phone', color: '#22b8a0' },
    { id: 'entertainment', icon: 'film', color: '#b05cf0' },
    { id: 'clothing', icon: 'shirt', color: '#f0609e' },
    { id: 'beauty', icon: 'sparkles', color: '#ff7eb6' },
    { id: 'medical', icon: 'medical', color: '#f0524f' },
    { id: 'education', icon: 'book', color: '#5b7cfa' },
    { id: 'travel', icon: 'plane', color: '#19b5d8' },
    { id: 'sports', icon: 'dumbbell', color: '#37b85c' },
    { id: 'social', icon: 'users', color: '#f07a4a' },
    { id: 'pets', icon: 'paw', color: '#b98a5a' },
    { id: 'other', icon: 'more', color: '#8e99a8' },
  ],
  income: [
    { id: 'salary', icon: 'wallet', color: '#37b85c' },
    { id: 'bonus', icon: 'award', color: '#f0a800' },
    { id: 'investment', icon: 'trending', color: '#f0524f' },
    { id: 'parttime', icon: 'briefcase', color: '#4a8cff' },
    { id: 'gift', icon: 'gift', color: '#ff5c8a' },
    { id: 'refund', icon: 'refund', color: '#22b8a0' },
    { id: 'other_income', icon: 'more', color: '#8e99a8' },
  ],
};

export const TRANSFER = { id: 'transfer', icon: 'swap', color: '#6b7a90' };

const ALL = new Map([...CATEGORIES.expense, ...CATEGORIES.income, TRANSFER].map((c) => [c.id, c]));

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
  return !!CATEGORIES[type]?.some((c) => c.id === id);
}
