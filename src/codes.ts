/**
 * 码表层：把接口返回的枚举名和数字码翻译成业务话术。
 *
 * 这里只做「码 → 文案」的查表，不做任何金额、方向、流向的推导。
 * 账本已经在 nrs-order-service 组装完毕（transferGroupId 配对、fundActionDesc
 * 文案、poolTypeDesc、balanceVerify 都是后端算好的），前端只负责呈现。
 *
 * 口径镜像自后端枚举，改动时对齐这些源文件：
 *   nrs-order-service-base/.../enumeration/ledger/
 *     LedgerGroupType / LedgerActionType / LedgerPoolType
 *     LedgerPairingReason / LedgerPairingStatus / LedgerEntryStatus / LedgerSourceTable
 *   nrs-order-service-base/.../enumeration/collection/AdvanceCollectionChangeSourceEnum
 *   nrs-order-service-base/.../enumeration/ItemChangeTypeEnum
 *   nrs-order-service-base/.../constant/PaymentCashierTypeEnum
 */

/** 操作性质，决定时间轴上的图标与配色。 */
export type ActionKind = 'PAY' | 'REFUND' | 'DEDUCT' | 'EXTERNAL' | 'FALLBACK';

export interface GroupTypeInfo {
  /** 业务话术，取自 LedgerGroupType.desc */
  label: string;
  kind: ActionKind;
  icon: string;
  /** LedgerGroupType.singleSided：单边操作，无本地对端腿，组级守恒豁免 */
  singleSided: boolean;
}

/** transferGroupId 前缀对应的动作语义。镜像 LedgerGroupType。 */
export const GROUP_TYPES: Record<string, GroupTypeInfo> = {
  CUST_PAY: { label: '客户支付', kind: 'PAY', icon: '↓', singleSided: false },
  ORDER_REFUND: { label: '订单退款', kind: 'REFUND', icon: '↩', singleSided: false },
  ADVANCE_REFUND: { label: '预收款退款', kind: 'REFUND', icon: '↩', singleSided: false },
  FUND_REFUND: { label: '整装款项退款', kind: 'REFUND', icon: '↩', singleSided: false },
  ADVANCE_DEDUCT: { label: '预收款抵扣', kind: 'DEDUCT', icon: '⇄', singleSided: false },
  WALLET_DEDUCT: { label: '余额抵扣', kind: 'DEDUCT', icon: '⇄', singleSided: false },
  FUND_DEDUCT: { label: '整装款项间抵扣', kind: 'DEDUCT', icon: '⇄', singleSided: false },
  WALLET_EXTERNAL: { label: '余额外部收支', kind: 'EXTERNAL', icon: '↕', singleSided: true },
  INTERNAL: { label: '内部流转/未配对', kind: 'FALLBACK', icon: '⚠', singleSided: true },
};

export const UNKNOWN_GROUP_TYPE: GroupTypeInfo = {
  label: '未识别操作', kind: 'FALLBACK', icon: '⚠', singleSided: true,
};

export function groupTypeInfo(groupType: string | null | undefined): GroupTypeInfo {
  return GROUP_TYPES[groupType ?? ''] ?? UNKNOWN_GROUP_TYPE;
}

export interface PoolTypeInfo {
  label: string;
  /** LedgerPoolScope：EXTERNAL 是系统外实体虚拟池（客户/开发商），不是系统内记账池 */
  scope: 'INTERNAL' | 'EXTERNAL';
}

/**
 * 镜像 LedgerPoolType + LedgerPoolScope。接口另有 poolTypeDesc，优先用接口值。
 * 图标不在这里：见 charts/icons.ts，按 poolType 取单色 SVG。
 */
export const POOL_TYPES: Record<string, PoolTypeInfo> = {
  CUSTOMER: { label: '客户钱包', scope: 'EXTERNAL' },
  DEVELOPER: { label: '开发商', scope: 'EXTERNAL' },
  SUB_ORDER: { label: '商品子单', scope: 'INTERNAL' },
  ADVANCE: { label: '预收款/首期款', scope: 'INTERNAL' },
  FUND: { label: '整装款项', scope: 'INTERNAL' },
  WALLET: { label: '客户余额', scope: 'INTERNAL' },
};

export const UNKNOWN_POOL_TYPE: PoolTypeInfo = { label: '其他资金池', scope: 'INTERNAL' };

export function poolTypeInfo(poolType: string | null | undefined): PoolTypeInfo {
  return POOL_TYPES[poolType ?? ''] ?? UNKNOWN_POOL_TYPE;
}

/**
 * 镜像 LedgerActionType.desc。
 * 仅作 fundActionDesc 缺失时的兜底 —— 接口的 fundActionDesc 已含渠道信息
 * （如「客户支付(微信)」），比这里的通用文案更具体，永远优先用它。
 */
export const ACTION_TYPES: Record<string, string> = {
  CUSTOMER_PAY: '客户支付',
  ADVANCE_DEDUCT: '预收款抵扣',
  ADVANCE_REFUND: '预收款退款',
  REFUND_TO_ADVANCE: '退款到预收款',
  REFUND_TO_CUSTOMER: '退款到客户',
  REFUND_ORIGINAL: '原路返还',
  REFUND_BANKCARD: '银行卡代付',
  REFUND_BALANCE: '退款到余额',
  REFUND_VENDOR: '退款到开发商',
  ADVANCE_REFUND_OUT: '预收款退款出款',
  PAY_IN: '支付入款',
  DEDUCT_OUT: '抵扣出款',
  WALLET_DEDUCT: '余额抵扣',
  WALLET_EXTERNAL: '余额外部收支',
  FUND_PAY: '整装款项支付入金',
  FUND_REFUND: '整装款项退款',
  FUND_DEDUCT_IN: '整装款项抵扣入金',
  FUND_WARRANT: '整装款项凭证收款',
  FUND_DEDUCT_OUT: '整装款项被抵扣出金',
  FUND_INDEMNITY: '整装款项理赔',
  FUND_WRITEOFF: '整装款项凭证冲销',
  FUND_PAY_CUSTOMER: '客户直付到整装款项',
  FUND_REFUND_TO_CUSTOMER: '整装款项退款到客户',
  ADVANCE_DESTROY: '异常单余额扣减',
  ORDER_REFUND: '订单退款',
  OTHER: '其他',
};

/** 镜像 LedgerEntryStatus.desc。 */
export const ENTRY_STATUS: Record<string, string> = {
  SUCCESS: '已完成/已到账',
  EXECUTING: '执行中/未到账',
  UNKNOWN: '未知',
};

/** 镜像 LedgerPairingStatus.desc。 */
export const PAIRING_STATUS: Record<string, string> = {
  SUCCESS: '已完成配对',
  UNRESOLVED: '无法归属/未识别，进入 INTERNAL 单边组',
};

/** 镜像 LedgerPairingReason.desc —— 服务者排查「为什么缺对端腿」时看这个。 */
export const PAIRING_REASONS: Record<string, string> = {
  CHANGE_SOURCE_MISSING: '预收款变更来源缺失',
  CHANGE_SOURCE_UNKNOWN: '预收款变更来源未识别',
  PAY_TRANSACTION_NO_MISSING: '支付交易号缺失',
  COMPOSIT_ORDER_NO_MISSING: '组合单号缺失',
  AFTER_SALE_NO_MISSING: '售后单号缺失',
  DEDUCT_RELATION_MISSING: '预收款抵扣关系缺失或不完整',
  DEDUCT_FUND_UNSUPPORTED: '预收款抵扣款项已下线',
  ADVANCE_DESTROY: '预收款异常销毁',
  FUND_TRANSACTION_NO_MISSING: '整装款项流水交易号缺失',
  ADVANCE_TO_FUND_UNSUPPORTED: '预收款抵扣整装款项已下线',
  TRANSACTION_NO_MISSING: '资金操作交易号缺失',
  PAY_INFO_MISSING: '支付信息未匹配',
  CASHIER_TYPE_MISSING: '收银台类型缺失',
  OUT_TRADE_NO_MISSING: '余额交易外部交易号缺失',
  REFUND_BRIDGE_FAILED: '退款桥接失败',
  AFTER_SALE_BRIDGE_FAILED: '售后单桥接失败',
  UNKNOWN: '未知异常',
};

/** 镜像 LedgerSourceTable，补上这张表在账本里的职责（仅服务者态展示）。 */
export const SOURCE_TABLES: Record<string, string> = {
  advance_collection_detail: '预收款收支明细',
  advance_collection_relation: '预收款抵扣关系',
  order_flow_apportionment: '收款流水分摊（S 单入金）',
  pay_info: '支付流水（客户实付）',
  fund_serial: '整装款项流水',
  account_biz_trade_request: '余额业务请求',
  item_change_record: '报价变更记录（减项出金）',
  order_info: '售后单',
  refund_transaction: '退款流水',
  refund_order: '退款单',
  unknown: '未知来源',
};

// ============ metadata 里的数字码 ============

/** 镜像 PaymentCashierTypeEnum。仅服务者态在溯源抽屉里展示原始码。 */
export const CASHIER_TYPES: Record<number, string> = {
  [-1]: '未知',
  1: 'APP SDK',
  3: '微信公众号（暂不使用）',
  5: '微信小程序',
  9: '小程序收银台',
  13: '微信小程序收银台',
  100: 'pos 支付',
  101: 'pos 支付',
  111: '装修分期',
  112: '对公汇款',
  113: '现金收款',
  114: '凭证支付',
  115: '预收款订单抵扣',
  116: '退款抵扣',
  123: '溢收款余额抵扣',
  124: '线上支付（支付宝/微信）',
  125: '款项抵扣',
  126: '客户余额抵扣',
  201: '支付宝扫码（待下线）',
  202: '支付宝扫码',
  306: '小程序支付',
};

/** 镜像 AdvanceCollectionChangeSourceEnum。 */
export const CHANGE_SOURCES: Record<number, string> = {
  0: '未知',
  10: '支付入款',
  20: '退款出款',
  30: '余额抵扣出款',
  40: '发起补收款',
  50: '订单退款转入',
  60: '回滚发起补收款',
  70: '异常单余额扣减',
  80: '取消支付中断引起应付调整',
  90: '款项单调整应收',
  100: '关闭订单',
};

/** 镜像 ItemChangeTypeEnum。 */
export const CHANGE_TYPES: Record<number, string> = {
  0: '默认',
  1: '增项',
  2: '减项',
  3: '实际用量增加',
  4: '实际用量减少',
  5: '合并更新商品',
  6: '合并新增商品',
};

/**
 * fund_serial.flow_type。
 * 口径来自《资金链路档案 - 数据口径》；枚举类不在 nrs-order-service 仓库内。
 */
export const FLOW_TYPES: Record<number, string> = {
  1: '线上支付',
  2: '退款',
  3: '抵扣',
  4: '凭证收款',
  5: '被抵扣',
  6: '理赔',
  7: '凭证冲销',
};

/**
 * order_info.refund_mode（退款去向）。
 * 口径来自《资金链路档案》；枚举类在售后域，不在本仓库内。
 */
export const REFUND_MODES: Record<number, string> = {
  1: '原路退回客户',
  2: '原路退回客户',
  4: '退至预收款',
  6: '退至客户余额',
  8: '退至开发商资金池',
};

/**
 * SubFundPoolInfo.subFundItemType。
 * 口径来自 SubFundPoolInfo 的字段注释（SubFundItemEnum 不在本仓库内）。
 */
export const SUB_FUND_ITEM_TYPES: Record<number, string> = {
  0: '增项款',
  1: '首期款',
  2: '开工款',
  3: '尾款',
};

/** metadata 的键 → 展示标签 + 可选码表，用于溯源抽屉逐行列出原始字段。 */
export const METADATA_FIELDS: Array<{ key: string; label: string; codes?: Record<number, string> }> = [
  { key: 'transactionNo', label: '资金交易号' },
  { key: 'outTradeNo', label: '外部交易号' },
  { key: 'bizTradeNo', label: '余额业务单号' },
  { key: 'afterSaleNo', label: '售后单号' },
  { key: 'afterSalesNo', label: '售后单号' },
  { key: 'projectChangeNo', label: '变更单号' },
  { key: 'compositOrderNo', label: '组合单号（CT 单）' },
  { key: 'refundFromOrderNo', label: '退款来源订单' },
  { key: 'refundOrderNo', label: '退款单号' },
  { key: 'businessId', label: '业务域' },
  { key: 'cashierType', label: '收银台类型', codes: CASHIER_TYPES },
  { key: 'changeSource', label: '预收款变更来源', codes: CHANGE_SOURCES },
  { key: 'changeType', label: '变更类型', codes: CHANGE_TYPES },
  { key: 'flowType', label: '款项流水类型', codes: FLOW_TYPES },
  { key: 'refundMode', label: '退款去向', codes: REFUND_MODES },
  { key: 'refundChannel', label: '退款渠道' },
  { key: 'tradeType', label: '余额交易类型' },
  { key: 'pairingStatus', label: '配对状态' },
  { key: 'pairingReason', label: '未配对原因' },
];

/** 数字码 + 码表 → 「码值 中文」，码表里没有就如实只显示码值。 */
export function codeLabel(value: unknown, codes?: Record<number, string>): string {
  if (value == null || value === '') return '';
  const raw = String(value);
  if (!codes) return raw;
  const desc = codes[Number(value)];
  return desc ? `${raw} ${desc}` : raw;
}
