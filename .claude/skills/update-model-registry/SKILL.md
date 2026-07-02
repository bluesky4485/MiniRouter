# Update Model Registry

定期更新 MiniRouter 模型数据库，收集最新定价、基准测试得分和新模型发布信息。建议每周或每月执行一次。

## 触发条件
- 用户说 "update model registry"、"更新模型数据"、"refresh model database" 等

---

## 官方数据源目录

### 定价页面（Pricing Pages）

| 厂商 | 官方定价页 URL | 渲染方式 | 可信度 |
|------|---------------|----------|:---:|
| **DeepSeek** | https://api-docs.deepseek.com/quick_start/pricing | 静态HTML | ✅ 直接可读 |
| **智谱 GLM** | https://open.bigmodel.cn/pricing | JS-SPA | ⚠️ 需浏览器 |
| **阿里百炼 (Qwen)** | https://help.aliyun.com/zh/model-studio/getting-started/models | 静态HTML | ✅ 直接可读 |
| **月之暗面 Kimi** | https://platform.kimi.com/docs/pricing | 静态HTML | ✅ 直接可读 |
| **腾讯混元** | https://cloud.tencent.com/document/product/1729/97731 | 静态HTML | ✅ 直接可读 |
| **字节豆包 (火山引擎)** | https://www.volcengine.com/docs/82379/1544106?lang=zh | 静态HTML | ✅ 已确认 |
| **MiniMax** | https://platform.minimaxi.com/docs/guides/pricing-paygo | 静态HTML | ✅ 已确认 |
| **百度文心 (千帆)** | https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a | 静态HTML | ✅ 已确认 |
| **阶跃星辰 Step** | https://platform.stepfun.com/docs/zh/guides/pricing/details | 静态HTML | ✅ 已确认 |
| **小米 MiMo** | https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go | 静态HTML | ✅ 已确认 |
| **美团 LongCat** | https://longcat.chat/platform/product | JS-SPA | ⚠️ 需浏览器 |

### 技术文档 & 模型发布公告（Tech Docs & Release Pages）

| 厂商 | 技术文档/发布页 | 用途 |
|------|----------------|------|
| **DeepSeek** | https://api-docs.deepseek.com/ | API文档、模型能力说明 |
| **DeepSeek** | https://arxiv.org/abs/ (搜索 DeepSeek-V4) | 技术论文、基准测试得分 |
| **智谱 GLM** | https://open.bigmodel.cn/dev/api/normal-model/glm-4 | API文档 |
| **智谱 GLM** | https://open.bigmodel.cn/ (新闻/公告区) | 模型发布公告 |
| **阿里百炼** | https://help.aliyun.com/zh/model-studio/ | 完整文档 |
| **阿里 Qwen** | https://qwenlm.github.io/blog/ | Qwen官方博客(论文/评测) |
| **月之暗面** | https://platform.kimi.com/docs | API文档 |
| **腾讯混元** | https://cloud.tencent.com/document/product/1729 | 完整产品文档 |
| **字节豆包** | https://www.volcengine.com/docs/82379 | 火山引擎AI文档 |
| **MiniMax** | https://platform.minimaxi.com/document/ | API文档 |
| **百度千帆** | https://cloud.baidu.com/doc/ | 千帆大模型文档 |
| **阶跃星辰** | https://platform.stepfun.com/docs | API文档 |
| **小米 MiMo** | https://mimo.mi.com/docs | API文档 |
| **美团 LongCat** | https://longcat.chat/platform | 开放平台 + https://github.com/Meituan-Dianping/LongCat 开源仓库 |

### ModelScope 模型页面（基准测试数据来源）

ModelScope (modelscope.cn) 是国内最大的模型社区，多数国产模型在此发布并附评测数据。

搜索方法：
1. 打开 https://modelscope.cn/models
2. 搜索模型名（如 "DeepSeek-V4"、"GLM-5"、"Qwen3"）
3. 进入模型详情页 → 查看"模型评测"(Benchmarks) 或 "README" 标签

已知 ModelScope 模型页面模式：

| 模型 | ModelScope 页面 | 备注 |
|------|----------------|------|
| DeepSeek-V4 | https://modelscope.cn/models/deepseek-ai/DeepSeek-V4 | 查 V4系列发布页 |
| GLM-5 | https://modelscope.cn/models/ZhipuAI/GLM-5 | 查5.2/5.1各版本 |
| Qwen3 | https://modelscope.cn/models/qwen/Qwen3 | 阿里官方发布 |
| Qwen3.5 | https://modelscope.cn/models/qwen/Qwen3.5 | 需确认 |
| MiniMax-M3 | https://modelscope.cn/models/MiniMax/MiniMax-M3 | 需确认 |
| 小米 MiMo | https://modelscope.cn/models/Xiaomi/MiMo | 需确认 |
| 美团 LongCat | https://modelscope.cn/models/Meituan/LongCat-2 | 需确认 |
| 阶跃 Step | https://modelscope.cn/models/stepfun/Step-2 | 需确认 |

> ⚠️ ModelScope 页面 URL 格式可能变化。如果上述链接 404，去 https://modelscope.cn/models 搜索模型名重新定位。

### 其他评测数据源

| 数据源 | URL | 内容 |
|--------|-----|------|
| LMSys Chatbot Arena | https://chat.lmsys.org/ | 用户偏好投票（主要海外模型） |
| LiveCodeBench | https://livecodebench.github.io/ | 代码能力评测排行榜 |
| OpenCompass | https://opencompass.org.cn/ | 上海AI Lab 模型评测平台（国产模型覆盖全） |
| SuperCLUE | https://www.superclueai.com/ | 中文大模型评测基准 |
| C-Eval | https://cevalbenchmark.com/ | 中文知识能力评测 |
| AlignBench | https://llmbench.ai/align | 中文对齐能力评测 |
| FlagEval (BAAI) | https://flageval.baai.ac.cn/ | 智源研究院评测 |

---

## 更新流程

### Step 1: 检查定价页面

对每个厂商：
1. 打开官方定价页 URL
2. 记录价格变动（输入/输出/缓存命中）
3. 记录新增模型
4. 标记已废弃模型（tier="deprecated"）
5. 在 notes 里记录检查日期和变动内容
6. 更新 dataStatus："confirmed"（如果从官方页面直接确认）

### Step 2: 检查新模型发布

1. 检查各厂商公告/Blog/新闻：
   - DeepSeek: api-docs.deepseek.com 首页
   - 智谱: open.bigmodel.cn 新闻区
   - 阿里: qwenlm.github.io/blog
   - 腾讯: cloud.tencent.com 产品公告
   - 字节: volcengine.com 文档更新
2. 搜索 ModelScope 最新模型
3. 对每个新模型：提取定价、上下文窗口、能力特性

### Step 3: 收集基准测试数据

优先级（从高到低）：
1. **模型官方发布公告/论文** — 最可信
2. **ModelScope 模型页面** — 多数国产模型在此发布评测
3. **OpenCompass / SuperCLUE / FlagEval** — 第三方评测平台
4. **技术博客** — Qwen Blog, DeepSeek Blog 等

对于每个能力维度，找对应评测：
- **代码 (code)** → LiveCodeBench / SWE-bench / HumanEval+
- **推理 (reasoning)** → AIME 2025 / GPQA / MATH-500
- **中文 (chinese)** → AlignBench / C-Eval / SuperCLUE / CMMLU
- **创意 (creative)** → 较难量化，参考 LMSys Arena 创意写作排名
- **速度 (speed)** → 首字延迟(TTFT) / 吞吐量(TPS) — 来自官方或第三方压测

> ⚠️ **绝对不要自己编造分数**。如果找不到公开评测数据，该维度留空（null），标记为"待评测"。

### Step 4: 更新 HTML 数据库

更新 `models-dashboard.html` 中 MODELS 数组：
1. 新增模型条目
2. 更新价格字段
3. 填入验证过的能力得分（score字段）
4. 更新 dataStatus: "confirmed" / "partial" / "unverified"
5. 更新 sourcePricing 和 sourceBenchmark URL
6. 在 notes 用格式 `"2026-07-XX: 做了什么更新"` 记录变更

### Step 5: 同步 SQLite

```bash
# 从 HTML 提取 JSON
node src/db/extract-models.mjs

# 写入 SQLite
npx tsx src/db/seed-models.ts
```

---

## 数据可信度标准

| 标记 | 含义 | 价格 | 能力分 | 可用于生产路由? |
|:----:|------|:----:|:------:|:--------------:|
| ✓ 已验证 | 全部来自官方 | 官方定价页确认 | 官方发布评测/论文 | ✅ 可以 |
| ⚠ 部分验证 | 价格已验证 | 官方定价页确认 | 待评测 | ⚠️ 仅价格可用 |
| ✗ 待确认 | 全部待确认 | 二手数据 | 无公开评测 | ❌ 不可用于生产 |

---

## 更新频率建议

| 频率 | 任务 |
|------|------|
| **每周** | 快速扫一遍各厂商定价页，看有无价格变动 |
| **每月** | 搜索新模型发布 + 更新 OpenCompass/SuperCLUE排行 |
| **每季度** | 全面审计 — 重新验证所有数据点，更新能力评分 |

---

## 模型名称规范

使用 `provider/model-name` 格式作为唯一 ID：
- `deepseek/v4-flash`
- `zhipu/glm-5.2`
- `alibaba/qwen3.6-max`
- `bytedance/seed-2.0-pro`
- `xiaomi/mimo-v2.5`
- `meituan/longcat-2.0`
- `minimax/m3`
- `tencent/hy3-preview`
- `moonshot/kimi-k2.7-code`
- `stepfun/step-3.7-flash`
- `baidu/ernie-5.0`