# Country-specific Rules Demo Pack

这套资料用于展示：**SI 和 draft BL 即使完全一致，也不代表符合目的国要求。**

## 文件说明

| Demo | 附件 | Carrier 写法 | 预期 comparison | 预期 compliance |
|---|---|---|---|---|
| 01 — Block | `01-block-si.txt` + `01-block-bl.txt` | `Shipping Line: Evergreen Marine` | `OK` | `BLOCK` |
| 02 — Pass | `02-pass-si.txt` + `02-pass-bl.txt` | `Vessel Operator: New Ocean Logistics` | `OK` | `PASS` |

辅助资料：

- `EMAIL_BLOCK.txt`：第一次检查时可复制的 email 内容
- `EMAIL_PASS.txt`：修正后重新检查时可复制的 email 内容
- `DEMO_FLOW.md`：3–4 分钟现场讲解流程
- `SOURCES.md`：公开规则来源及 demo 边界

## 启动

在项目根目录运行：

```powershell
python -m uvicorn web.app:app --reload
```

浏览器打开：

```text
http://127.0.0.1:8000/#/try
```

如果页面之前已经打开，按 `Ctrl+F5` 强制刷新。

## Demo 01：文件一致，但被国家规则拦截

1. 从 `EMAIL_BLOCK.txt` 复制 From、Subject 和正文。
2. 上传：
   - `01-block-si.txt`
   - `01-block-bl.txt`
3. 等待自动识别完成。
4. 确认页面自动填写：
   - Carrier：`EVERGREEN`
   - Origin：`MY`
   - Destination：`ID`
   - Shipper：`VITAL SOLUTIONS SDN BHD; KUALA LUMPUR, MALAYSIA`
   - Consignee：`GLOBAL PAPER TRADING LLC; DUBAI, UNITED ARAB EMIRATES`
5. 点击任一附件旁的 **Preview**，展示系统读取到的原始内容。
6. 点击 **Process email**。

预期结果：

- Document comparison：`OK`
- Country compliance：`BLOCK`
- Local Indonesian consignee：`BLOCK`
- Consignee Tax ID / NPWP：`BLOCK`

这里的 SI 与 BL 内容完全相同，但 consignee 是 Dubai 公司，而且没有 NPWP。

## Demo 02：修正后通过

1. 清除或重新载入 Try an email 页面。
2. 从 `EMAIL_PASS.txt` 复制 email 内容。
3. 上传：
   - `02-pass-si.txt`
   - `02-pass-bl.txt`
4. 确认系统自动识别：
   - Carrier：`NEW OCEAN LOGISTICS`
   - Origin：`MY`
   - Destination：`ID`
   - Shipper：`VITAL SOLUTIONS SDN BHD; KUALA LUMPUR, MALAYSIA`
   - Consignee：`PT NUSANTARA LOGISTICS INDONESIA; ... JAKARTA, INDONESIA; NPWP ...`
5. 用 Preview 指出 consignee 的 Jakarta 地址和 labelled NPWP。
6. 点击 **Process email**。

预期结果：

- Document comparison：`OK`
- Country compliance：`PASS`
- Local Indonesian consignee：`PASS`
- Consignee Tax ID / NPWP：`PASS`

## Demo 要表达的重点

1. Carrier、起运国和目的国来自附件，不需要人工填写。
2. Carrier 识别不限定 Maersk：示例使用 Evergreen 和一个任意的新 carrier。
3. Indonesia 规则对所有 carrier 生效。
4. Document consistency 和 country compliance 是两个不同结论。
5. 每条合规结果都有 evidence、建议操作和 published source。
