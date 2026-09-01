/**
 * 纯展示类型。
 *
 * 业务枚举的中文、分类和单边属性均由账本接口返回；前端不维护业务码表。
 */
export type ActionKind = 'PAY' | 'REFUND' | 'DEDUCT' | 'EXTERNAL' | 'FALLBACK' | 'OTHER';

export interface GroupTypeInfo {
  label: string;
  kind: ActionKind;
  icon: string;
  singleSided: boolean;
}
