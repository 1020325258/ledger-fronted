# ledger-fronted

客户资金账本可视化（fund-ledger-frontend）

## 项目简介

展示 `nrs-order-service` 的 `/ledger/project` 接口返回的统一资金账本数据，目标是从客户或服务者视角，一眼看清资金在多个资金池之间的流向与余额变化。

## 技术栈

- Vite + TypeScript
- ECharts（余额图表）
- 自绘 SVG（全局资金流向图）

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

- `src/main.ts` — 页面入口、数据请求与各视图渲染
- `src/flow.ts` — 资金流向图的连边推导（transferGroupId 配对 + 语义规则）
- `src/flowview.ts` — 全局资金流向图（自绘 SVG）
- `src/style.css` — 样式
