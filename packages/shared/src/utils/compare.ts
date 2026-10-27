// packages/shared/src/utils/compare.ts — thứ tự tin nhắn theo tuple (createdAt, id) (D-20)
export interface OrderedItem {
  createdAt: string | Date;
  id: string;
}

const time = (v: string | Date): number => (typeof v === 'string' ? Date.parse(v) : v.getTime());

/** < 0 nếu a trước b, > 0 nếu a sau b, 0 nếu cùng vị trí. ObjectId hex cùng độ dài nên so chuỗi = so giá trị. */
export function compareMessageOrder(a: OrderedItem, b: OrderedItem): number {
  const dt = time(a.createdAt) - time(b.createdAt);
  if (dt !== 0) return dt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
