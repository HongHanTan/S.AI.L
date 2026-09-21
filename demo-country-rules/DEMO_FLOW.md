# 3–4 分钟现场 Demo Flow

## 0:00–0:30 — 说明业务缺口

建议讲法：

> 原有系统检查 SI 和 draft BL 的七个关键字段是否一致。但文件一致，
> 不代表符合目的国规定。现在系统会再做独立的 country compliance check。

打开 **Try an email** 页面，指出 Carrier、Origin Country、Destination Country
都是自动识别字段。

## 0:30–1:45 — Demo 01：一致但不合规

1. 输入 `EMAIL_BLOCK.txt` 的 email 内容。
2. 上传 `01-block-si.txt` 和 `01-block-bl.txt`。
3. 等待页面自动显示 `EVERGREEN · MY → ID`，并自动填入 Shipper 和 Consignee。
4. 点击 **Preview**，指出：
   - 标签写的是 `Shipping Line`，系统仍能识别 Carrier；
   - POD 是 Jakarta, Indonesia；
   - Consignee 位于 Dubai；
   - 没有 NPWP。
5. 点击 **Process email**。

建议讲法：

> 两份文件七个字段完全一致，所以 comparison 是 OK。但 Indonesia import
> 要求 local consignee 和 Tax ID，因此 country compliance 独立返回 BLOCK。

强调屏幕上的两个失败 finding 和操作建议。

## 1:45–2:50 — Demo 02：修正后通过

1. 换成 `02-pass-si.txt` 和 `02-pass-bl.txt`。
2. 指出 Carrier 自动识别为 `NEW OCEAN LOGISTICS`，Shipper/Consignee 也从 SI 自动填入。
3. Preview 文件，指出：
   - `Vessel Operator` 也能作为 Carrier 语义识别；
   - Consignee 是 Jakarta 本地公司；
   - NPWP 有明确标签。
4. 点击 **Process email**。

建议讲法：

> 这不是 Maersk 白名单。即使是系统从未见过的新 carrier，只要附件明确写出
> carrier 语义和路线，Indonesia country rule 仍然执行。修正 party information
> 后，comparison 与 compliance 都通过。

## 2:50–3:30 — 说明可审计性

展开或指向 compliance finding 的 published requirement link。

建议讲法：

> 系统不是让模型临时编造规则。Carrier 和路线由附件证据抽取，规则由版本化
> 配置执行，每个 finding 都包含规则编号、来源、证据和下一步动作。

## 3:30–4:00 — 总结

> 现在系统同时回答两个问题：文件是否一致，以及 shipment 是否满足目的国要求。
> 新国家规则可以继续加入规则配置，不需要改动原有七字段 comparison engine。

## 现场检查清单

- 服务已启动并可以打开 `#/try`
- 浏览器已 `Ctrl+F5`
- 两组附件都能上传
- Preview dialog 能打开和关闭
- Demo 01 显示 `OK + BLOCK`
- Demo 02 显示 `OK + PASS`
- 网络不可用时，comparison 与本地 country rule 仍可运行
