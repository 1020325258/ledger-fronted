# ledger-fronted

客户资金账本可视化（fund-ledger-frontend）

## 项目简介

展示 `nrs-order-service` 的 `/ledger/project` 接口返回的统一资金账本数据，目标是从客户或服务者视角，一眼看清资金在多个资金池之间的流向与余额变化，让双方对资金有全局统一的理解。

## 页面能力

- **双视角切换**：
  - 👤 客户视角：我的钱在哪（实付/退款/净投入 + 系统内资金分布）、客户资金旅程时间线、余额概览图表
  - 🏢 服务者视角：全局资金流向图、跨池交易组明细（transferGroupId 全腿证据链）、CT/S/FU 资金池层级、守恒与对账验证面板
- **守恒校验**：接口 `isBalanced` + `balanceVerifySummary`（逐池对账）+ `groupVerifySummary`（跨池交易组守恒）+ `warnings`（资金池归属断链告警）
- **URL 可分享**：查询参数 `projectOrderId / env / verify / mode / perspective` 自动同步到地址栏，刷新不丢
- **平铺明细**：全部流水按时间排列，直接看到每一笔的来源与去向

## 技术栈

- Vite + TypeScript
- ECharts（余额图表）
- 自绘 SVG（全局资金流向图，连边优先按 `transferGroupId` 配对，`groupType`/动作语义兜底，并标注可信度）

## 本地运行

```bash
npm install
npm run dev
```

访问 http://127.0.0.1:5173，输入主单号（projectOrderId）即可查询账本。

## 接口说明

```bash
curl --location --request GET 'nrs-order-service.nrs-escrow.ttb.test.ke.com/ledger/project?projectOrderId=<主单号>&verify=false&groupByPool=false' \
  --header 'X-NRS-User-Id: 1000000000000000' \
  --header 'Content-Type: application/json'
```

- `groupByPool=false`：返回平铺明细 `entries`
- `groupByPool=true`：返回按资金池分组的 `pools`
- `verify=true`：附带逐池余额验证与跨池交易组守恒验证

## 目录结构

- `src/api.ts` — 数据层：接口类型、请求封装、URL 查询状态、格式化工具
- `src/main.ts` — 页面入口：查询栏、视角切换、各区块编排、流向图下钻
- `src/views.ts` — 视图层：概览、客户视角（我的钱在哪/时间线）、服务者视角（交易组/资金池/验证面板）、图表
- `src/flow.ts` — 资金流向图的连边推导（transferGroupId 配对 + 语义规则）
- `src/flowview.ts` — 全局资金流向图（自绘 SVG）
- `src/style.css` — 样式

## 访问示例

```text
http://127.0.0.1:5173/?projectOrderId=826080616000002432&env=escrow&verify=true&perspective=service&mode=grouped
```
