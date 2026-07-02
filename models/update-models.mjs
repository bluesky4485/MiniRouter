/**
 * Update dashboard.html with verified pricing + new models
 * Run: node models/update-models.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("models/dashboard.html", "utf-8");

// Find MODELS array boundaries
const startMarker = "const MODELS = [";
const idx = html.indexOf(startMarker);
const tail = html.slice(idx + startMarker.length);

// Count brackets to find matching ]
let depth = 1, end = 0;
for (let i = 0; i < tail.length && depth > 0; i++) {
  if (tail[i] === "[" || tail[i] === "{") depth++;
  if (tail[i] === "]" || tail[i] === "}") depth--;
  if (depth === 0) { end = i; break; }
}
const semiIdx = tail.slice(end).indexOf(";");
const actualEnd = end + semiIdx + 1;

const before = html.slice(0, idx);
const after = html.slice(idx + startMarker.length + actualEnd);
const idCount = (html.slice(idx, idx + startMarker.length + end).match(/"id":/g) || []).length;
console.log(`Found ${idCount} existing models`);

// ══════════════════════════════════════════════════════════════
// Complete model data with verified pricing
// ══════════════════════════════════════════════════════════════
function m(id, provider, displayName, type, input, output, cacheHit, ctx, maxOut, tools, json, vision, video, audio, releaseDate, notes, dataStatus, srcPricing, codingScore, reasoningScore, srcBenchmark) {
  return { id, provider, displayName, type,
    pricing: { input, output, cacheHit },
    scores: { coding: codingScore, reasoning: reasoningScore, chinese: null, creative: null, speed: null },
    specs: { contextWindow: ctx, maxOutput: maxOut, supportsTools: tools, supportsJson: json },
    multimodal: { vision, video, audio },
    releaseDate, notes, dataStatus, sourcePricing: srcPricing, sourceBenchmark: srcBenchmark };
}

const MODELS = [
  m("deepseek/v4-flash","DeepSeek","DeepSeek V4 Flash","domestic",1.01,2.02,0.02,1048576,384000,true,true,false,false,false,"2026-05","1M上下文,384K输出。LiveCodeBench 91.6,GPQA 88.1。","confirmed","https://api-docs.deepseek.com/quick_start/pricing",91.6,88.1,"https://www.datalearner.com/en/ai-models/compare/deepseek-v4-pro/vs/deepseek-v-3_1"),
  m("deepseek/v4-pro","DeepSeek","DeepSeek V4 Pro","domestic",3.13,6.26,0.026,1048576,384000,true,true,true,false,false,"2026-05","支持thinking mode。LiveCodeBench 93.5(全球#1),GPQA 90.1,SWE-bench 80.6。","confirmed","https://api-docs.deepseek.com/quick_start/pricing",93.5,90.1,"https://www.datalearner.com/en/ai-models/compare/deepseek-v4-pro/vs/deepseek-v-3_1"),
  m("deepseek/v3.2","DeepSeek","DeepSeek V3.2","deprecated",2.0,8.0,null,131072,16384,true,true,false,false,false,"2025-Q4","2026-07-24废弃。R1-0528:LCB73.3,AIME87.5,GPQA81.0。","partial","https://api-docs.deepseek.com/quick_start/pricing",null,null,"https://www.datalearner.com/en/ai-models/compare/deepseek-v4-pro/vs/DeepSeek-R1-0528"),
  // ═══ 智谱 GLM ═══ (from open.bigmodel.cn 官方定价)
  m("zhipu/glm-5.2","智谱","GLM-5.2","domestic",8.0,28.0,2.0,1048576,32768,true,true,true,false,false,"2026-06-17","旗舰。1M上下文。Code Arena全球#1(1595)。SWE-bench Pro62.1,GPQA~90。","confirmed","https://open.bigmodel.cn/pricing",95,90,"https://huggingface.co/zai-org/GLM-5.2"),
  m("zhipu/glm-5.1","智谱","GLM-5.1","domestic",6.0,24.0,1.3,128000,16384,true,true,true,false,false,"2026-03","推理模型。华为昇腾训练。LCB77.2,GPQA86.2,AIME95.3,SWE-bench58.4。","confirmed","https://open.bigmodel.cn/pricing",77.2,86.2,"https://www.datalearner.com/ai-models/compare/glm-5-2/vs/glm-5-1"),
  m("zhipu/glm-5-turbo","智谱","GLM-5-Turbo","domestic",5.0,22.0,1.2,128000,16384,true,true,false,false,false,"2026-Q1","≤32K¥5/22,>32K¥7/26。缓存限免。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-5","智谱","GLM-5","domestic",4.0,18.0,1.0,128000,16384,true,true,false,false,false,"2026-02","聊天模型。LCB68.9,GPQA86.0,AIME92.7。","confirmed","https://open.bigmodel.cn/pricing",68.9,86.0,"https://www.datalearner.com/ai-models/compare/glm-5-1/vs/glm-5"),
  m("zhipu/glm-4.7","智谱","GLM-4.7","domestic",2.0,8.0,0.4,200000,16384,true,true,false,false,false,"2026-Q1","分段:≤32K且输出≤200t:¥2/8;输出>200t:¥3/14;32-200K:¥4/16。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4.7-flashx","智谱","GLM-4.7-FlashX","domestic",0.5,3.0,0.1,200000,8192,true,false,false,false,false,"2026-Q1","高速低价。200K上下文¥0.5/3。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4.7-flash","智谱","GLM-4.7-Flash","domestic",0,0,0,200000,4096,false,false,false,false,false,"2026-Q1","免费！200K上下文。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4-plus","智谱","GLM-4-Plus","domestic",5.0,5.0,2.5,131072,8192,true,true,false,false,false,"2025-Q3","高智能旗舰。输入输出同价¥5。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4-air","智谱","GLM-4-Air","domestic",0.5,0.5,0.25,131072,8192,true,true,false,false,false,"2025","高性价比。¥0.5同价。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4-long","智谱","GLM-4-Long","domestic",1.0,1.0,0.5,1048576,8192,false,false,false,false,false,"2025","1M上下文。¥1/1。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4-flash","智谱","GLM-4-Flash","domestic",0,0,null,131072,8192,false,false,false,false,false,"2024-Q4","免费！128K上下文。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-4-flashx","智谱","GLM-4-FlashX","domestic",0.1,0.1,0.05,131072,8192,true,false,false,false,false,"2025-H1","高速低价。¥0.1同价。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-z1-air","智谱","GLM-Z1-Air","domestic",0.5,0.5,null,131072,8192,false,false,false,false,false,"2025","推理模型。¥0.5输入(仅推理,无输出价)。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-z1-flash","智谱","GLM-Z1-Flash","domestic",0,0,null,131072,8192,false,false,false,false,false,"2025","免费推理模型。","confirmed","https://open.bigmodel.cn/pricing"),
  m("zhipu/glm-z1-flashx","智谱","GLM-Z1-FlashX","domestic",0.1,0.1,null,131072,8192,false,false,false,false,false,"2025","高速低价推理。","confirmed","https://open.bigmodel.cn/pricing"),
  // ═══ 阿里千问 ═══ (华北2北京, 中国内地最低阶梯价)
  m("alibaba/qwen3.7-max","阿里","Qwen3.7-Max","domestic",12.0,36.0,null,1048576,131072,true,true,false,false,true,"2026-07","最新旗舰。AA综合56.6分全球#5国产#1。LiveCodeBench91.6,GPQA92.4,SWE-bench80.4。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models",91.6,92.4,"https://www.datalearner.com/ai-models/pretrained-models/qwen3-7-max-preview/analysis"),
  m("alibaba/qwen3.7-plus","阿里","Qwen3.7-Plus","domestic",2.0,8.0,null,1048576,131072,true,true,false,false,false,"2026-07","多模态Agent模型。MMLU88.5,LiveCodeBench89.6,GPQA90.3,ScreenSpot Pro79.0。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models",89.6,90.3,"https://aiflashreport.com/models/qwen3-7-plus/"),
  m("alibaba/qwen3-max","阿里","Qwen3-Max","domestic",2.5,10.0,null,262144,16384,true,true,false,false,false,"2026-01","阶梯≤32K¥2.5/10。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models",null,null,null),
  m("alibaba/qwen3.5-plus","阿里","Qwen3.5-Plus","domestic",0.8,4.8,null,1048576,16384,true,true,false,false,false,"2026-Q1","阶梯:≤128K¥0.8/4.8,128-256K¥2/12,>256K¥4/24。Batch半价。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3.6-flash","阿里","Qwen3.6-Flash","domestic",1.2,7.2,null,1048576,16384,true,true,false,false,false,"2026-Q1","阶梯:≤256K¥1.2/7.2,>256K¥4.8/28.8。Batch半价。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3.5-flash","阿里","Qwen3.5-Flash","domestic",0.2,2.0,null,1048576,16384,true,true,false,false,false,"2026-Q1","阶梯:≤128K¥0.2/2,128-256K¥0.8/8,>256K¥1.2/12。极便宜。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-turbo","阿里","Qwen-Turbo","domestic",0.3,0.6,null,131072,8192,false,false,false,false,false,"2025","经典便宜老将。非思考¥0.3/0.6,思考模式¥0.3/3。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwq-plus","阿里","QwQ-Plus","domestic",1.6,4.0,null,131072,16384,false,false,false,false,false,"2026","推理专用。仅思考模式。¥1.6/4。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-long","阿里","Qwen-Long","domestic",0.5,2.0,null,10485760,8192,false,false,false,false,false,"2025","长文档专用(10M上下文)。¥0.5/2。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-vl-max","阿里","Qwen-VL-Max","domestic",1.6,4.0,null,32768,8192,false,false,true,false,false,"2025","视觉旗舰。无阶梯。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-vl-plus","阿里","Qwen-VL-Plus","domestic",0.8,2.0,null,32768,8192,false,false,true,false,false,"2025","视觉中端。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-coder-plus","阿里","Qwen-Coder-Plus","domestic",3.5,7.0,null,131072,8192,true,true,false,false,false,"2025","代码通用。无阶梯。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen-mt-plus","阿里","Qwen-MT-Plus","domestic",1.8,5.4,null,32768,4096,false,false,false,false,false,"2025","翻译专用。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3-vl-plus","阿里","Qwen3-VL-Plus","domestic",1.0,10.0,null,262144,16384,true,true,true,false,false,"2026","视觉最新。阶梯:≤32K¥1/10,32-128K¥1.5/15。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3-vl-flash","阿里","Qwen3-VL-Flash","domestic",0.15,1.5,null,262144,8192,true,true,true,false,false,"2026","视觉轻量。阶梯:≤32K¥0.15/1.5。极便宜视觉。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3-coder-plus","阿里","Qwen3-Coder-Plus","domestic",4.0,16.0,null,1048576,32768,true,true,false,false,false,"2026","最新代码旗舰。阶梯:≤32K¥4/16,32-128K¥6/24。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("alibaba/qwen3.5-omni-plus","阿里","Qwen3.5-Omni-Plus","domestic",7.0,40.0,null,131072,8192,true,true,true,true,true,"2026-Q1","全模态(文本¥7/40+音频¥53/213)。","confirmed","https://help.aliyun.com/zh/model-studio/getting-started/models"),
  m("bytedance/seed-evolving","字节","Seed-Evolving","domestic",6.0,30.0,1.2,256000,16384,true,true,false,false,false,"2026-Q2","最新实验旗舰。≤256K统一价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-2.1-pro","字节","Seed-2.1-Pro","domestic",6.0,30.0,1.2,256000,16384,true,true,true,true,false,"2026-Q2","豆包最新旗舰。≤256K统一价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-2.1-turbo","字节","Seed-2.1-Turbo","domestic",3.0,15.0,0.6,256000,16384,true,true,false,false,false,"2026-Q2","加速版。Batch半价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-2.0-pro","字节","Seed-2.0-Pro","domestic",3.2,16.0,0.64,128000,16384,true,true,true,true,false,"2026-02","MMLU-Pro87.0,GPQA88.9,LCB87.8,AIME2025=98.3。视频SOTA,Agent强。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh",87.8,88.9,"https://evolink.ai/zh/blog/doubao-seed-2-0-review-benchmarks-pricing"),
  m("bytedance/seed-2.0-lite","字节","Seed-2.0-Lite","domestic",0.6,3.6,0.12,128000,8192,true,true,false,false,false,"2026-Q2","支持音频输入¥9/M。阶梯定价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-2.0-mini","字节","Seed-2.0-Mini","domestic",0.2,2.0,0.04,128000,8192,true,true,false,false,false,"2026-Q2","支持音频输入¥3/M。阶梯定价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-2.0-code","字节","Seed-2.0-Code","domestic",3.2,16.0,0.64,256000,32768,true,true,false,false,false,"2026-Q2","代码专用。≤32K¥3.2/16。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-1.8","字节","Seed-1.8","deprecated",0.80,2.0,0.16,256000,16384,true,true,false,false,false,"2026-Q1","分段:输出≤200t时¥2,>200t时¥8。Batch¥1/4。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-character","字节","Seed-Character","domestic",0.80,2.0,0.16,128000,8192,true,true,false,false,false,"2026-Q1","角色扮演专用。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-code","字节","Seed-Code","deprecated",1.20,8.0,0.24,256000,16384,true,true,false,false,false,"2025-Q4","旧代码模型。被Seed-2.0-Code替代。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-1.6","字节","Seed-1.6","deprecated",0.80,2.0,0.16,256000,16384,true,true,false,false,false,"2025-Q4","分段:输出≤200t时¥2,>200t时¥8。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-1.6-lite","字节","Seed-1.6-Lite","deprecated",0.30,0.60,0.06,256000,8192,true,true,false,false,false,"2025-Q4","分段:输出≤200t时¥0.6,>200t时¥2.4。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-1.6-flash","字节","Seed-1.6-Flash","domestic",0.15,1.50,0.03,256000,8192,false,false,false,false,false,"2026-Q1","🏆全场最低¥0.15。Batch¥0.075/0.75更便宜。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-1.6-vision","字节","Seed-1.6-Vision","deprecated",0.80,8.0,0.16,256000,16384,true,true,true,false,false,"2025-Q4","旧视觉。Batch¥4/12。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/seed-translation","字节","Seed-Translation","domestic",1.20,3.60,null,null,8192,false,false,false,false,false,"2026-Q1","翻译专用。统一价。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/doubao-1.5-pro-32k","字节","豆包1.5-Pro-32K","deprecated",0.80,2.0,0.16,32768,8192,true,true,false,false,false,"2025","旧豆包旗舰。被Seed替代。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/doubao-1.5-lite-32k","字节","豆包1.5-Lite-32K","deprecated",0.30,0.60,0.06,32768,4096,false,false,false,false,false,"2025","旧豆包轻量。被Seed替代。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("bytedance/doubao-1.5-vision-pro","字节","豆包1.5-Vision-Pro","deprecated",3.0,9.0,null,32768,8192,true,true,true,false,false,"2025","旧豆包视觉。被Seed替代。","confirmed","https://www.volcengine.com/docs/82379/1544106?lang=zh"),
  m("xiaomi/mimo-v2.5","小米","MiMo-V2.5","domestic",1.0,2.0,0.02,1048576,16384,true,true,true,true,true,"2025-Q4","全模态+极快。2026.6.30V2废弃。","confirmed","https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go"),
  m("xiaomi/mimo-v2.5-pro","小米","MiMo-V2.5-Pro","domestic",3.0,6.0,0.025,1048576,32768,true,true,true,true,true,"2026-Q1","全模态旗舰+1M上下文。LiveCodeBench80.6,SWE-bench78.9,MMLU86.7,GPQA Diamond76.2。","confirmed","https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go",80.6,76.2,"https://hf-mirror.com/XiaomiMiMo/MiMo-V2.5-Pro"),
  m("xiaomi/mimo-v2-flash","小米","MiMo-V2-Flash","deprecated",null,null,null,131072,8192,true,true,true,false,false,"2025-Q4","V2系列已废弃2026.6.30。","confirmed","https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go"),
  m("meituan/longcat-2.0","美团","LongCat-2.0","domestic",2.0,8.0,0.04,1048576,131072,true,true,false,false,false,"2026-06-30","1.6T MoE MIT开源。SWE-bench Pro59.5(超GPT-5.5),Terminal-Bench70.8。折扣¥2/8。","confirmed","https://longcat.chat/platform/product",93,85,"https://news.qiniu.com/archives/1782873868042"),
  m("minimax/m3","MiniMax","MiniMax M3","domestic",2.10,8.40,0.42,512000,16384,true,true,true,false,false,"2026-Q1","1M上下文。GPQA Diamond92.9(全球前4),SWE-bench Pro59.0(超GPT-5.5),LiveCodeBench74.0。","confirmed","https://platform.minimaxi.com/docs/guides/pricing-paygo",74.0,92.9,"https://codingfleet.com/blog/minimax-m3-vs-deepseek-v4-pro-the-open-weight-chinese-ai-showdown/"),
  m("minimax/m2.7","MiniMax","MiniMax M2.7","deprecated",2.10,8.40,0.42,197000,8192,true,true,true,false,false,"2025-Q4","有highspeed×2价。缓存写入¥2.625/M。被M3替代。","confirmed","https://platform.minimaxi.com/docs/guides/pricing-paygo"),
  m("tencent/hy3-preview","腾讯","混元Hy3 Preview","domestic",null,null,null,131072,16384,true,true,false,false,false,"2026-06","姚顺雨带队重建。SWE-bench74.4,Terminal-Bench54.4,GPQA Diamond0.7。295B MoE。","unverified",null,null,null,null),
  m("tencent/hunyuan-turbos","腾讯","混元TurboS","domestic",0.80,2.0,null,131072,8192,true,true,false,false,false,"2025-Q4","¥0.8/2.0极低。","confirmed","https://cloud.tencent.com/document/product/1729/97731",null,null,null),
  m("tencent/hunyuan-a13b","腾讯","混元A13B","domestic",0.50,2.0,null,131072,8192,true,true,false,false,false,"2025-Q4","¥0.5极低输入。新用户送100万token。","confirmed","https://cloud.tencent.com/document/product/1729/97731"),
  m("tencent/hunyuan-lite","腾讯","混元Lite","domestic",0,0,null,32768,4096,false,false,false,false,false,"2025","永久免费。","confirmed","https://cloud.tencent.com/document/product/1729/97731"),
  m("tencent/hy2.0-think","腾讯","混元HY2.0 Think","domestic",4.0,16.0,null,131072,16384,false,false,false,false,false,"2026-Q1","推理专用。","confirmed","https://cloud.tencent.com/document/product/1729/97731"),
  m("moonshot/kimi-k2.7-code","月之暗面","Kimi K2.7 Code","domestic",6.50,27.0,1.30,262144,32768,true,true,true,false,false,"2026-06","最强Coding。⚠️所有评测为自研内部基准(KimiCodeBench62.0,ProgramBench53.6),无LiveCodeBench/SWE-bench/AIME等公开数据。","confirmed","https://platform.kimi.com/docs/pricing/chat-k27-code",null,null,"https://www.kimi.com/resources/kimi-k2-7-code"),
  m("moonshot/kimi-k2.7-code-highspeed","月之暗面","Kimi K2.7 Code HS","domestic",13.0,54.0,2.60,262144,32768,true,true,true,false,false,"2026-06","高速版180-260TPS。","confirmed","https://platform.kimi.com/docs/pricing/chat-k27-code"),
  m("moonshot/kimi-k2.6","月之暗面","Kimi K2.6","deprecated",6.50,27.0,1.10,262144,16384,true,true,true,false,false,"2026-Q1","被K2.7 Code替代。","confirmed","https://platform.kimi.com/docs/pricing/chat-k26"),
  m("stepfun/step-3.7-flash","阶跃星辰","Step 3.7 Flash","domestic",1.35,8.10,0.27,131072,16384,true,true,false,false,false,"2026-Q2","多模态推理。196B MoE,400TPS极速。Agent任务成本仅为Claude1/9。无LiveCodeBench/MMLU公开数据。","confirmed","https://platform.stepfun.com/docs/zh/guides/pricing/details",null,null,null),
  m("stepfun/step-3.5-flash","阶跃星辰","Step 3.5 Flash","domestic",0.70,2.10,0.14,256000,8192,true,true,false,false,false,"2026-02","Agent基座。196B MoE,11B激活。LCB86.4,AIME97.3,SWE-bench74.4,登顶OpenRouter趋势榜。","confirmed","https://platform.stepfun.com/docs/zh/guides/pricing/details",86.4,97.3,"https://llm-stats.com/models/compare/mimo-v2-flash-vs-step-3.5-flash"),
  m("stepfun/step-1o-turbo-vision","阶跃星辰","Step1o Turbo Vision","domestic",2.50,8.0,0.50,131072,8192,true,true,true,false,false,"2025-Q4","视觉模型。","confirmed","https://platform.stepfun.com/docs/zh/guides/pricing/details"),
  m("stepfun/step-2","阶跃星辰","Step-2","domestic",null,null,null,131072,16384,true,true,true,true,false,"2025-Q4","多模态旗舰。价格待确认。","unverified","https://platform.stepfun.com/docs/zh/guides/pricing/details"),
  m("baidu/ernie-5.0","百度","ERNIE-5.0","domestic",6.0,24.0,null,128000,16384,true,false,true,false,false,"2026-Q1","百度旗舰。MMLU-Pro87.0,GPQA85.0,AIME87.0,LiveCodeBench~81。","confirmed","https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a",81,85,"https://llm-stats.com/models/compare/ernie-5.0-vs-qwen3.5-0.8b"),
  m("baidu/ernie-4.5-turbo","百度","ERNIE 4.5 Turbo","domestic",0.80,3.20,0.20,131072,8192,true,false,true,false,false,"2026-Q1","¥0.8/3.2便宜。缓存¥0.2。Batch¥0.32/1.28。需适配器。","confirmed","https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a"),
  m("baidu/ernie-x1.1","百度","ERNIE X1.1","domestic",1.0,4.0,null,131072,16384,false,false,false,false,false,"2026-Q1","推理模型。¥1/4。","confirmed","https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a"),
  m("openai/gpt-5.5","OpenAI ⚑","GPT-5.5","international",36.0,216.0,18.0,1048576,131072,true,true,true,false,false,"2026-Q1","仅供价格对标。","confirmed","https://openai.com/api/pricing/"),
  m("anthropic/claude-opus-4.8","Anthropic ⚑","Claude Opus 4.8","international",36.0,180.0,null,1048576,131072,true,true,true,false,false,"2026-06","仅供价格对标。","confirmed","https://www.anthropic.com/pricing"),
  m("google/gemini-3-flash","Google ⚑","Gemini 3 Flash","international",7.2,28.8,null,1048576,32768,true,true,true,true,true,"2026-Q2","仅供价格对标。","confirmed","https://ai.google.dev/pricing"),
];

// Build new HTML
const newModelsJson = JSON.stringify(MODELS, null, 2)
  .replace(/"type":/g, "type:");

let newHtml = before + "const MODELS = " + newModelsJson + after;

// Default: show only domestic + international (hide deprecated)
// Insert sortField/sortDir before render if not present
newHtml = newHtml.replace(
  'initProviders();\n',
  'initProviders();\nlet sortField = "displayName";\nlet sortDir = 1;\n'
);
newHtml = newHtml.replace(
  'document.getElementById("filterType").value = "active";\n',
  ''
);

// Add "active" option to filter dropdown
newHtml = newHtml.replace(
  '<option value="">全部类型</option>',
  '<option value="">全部</option>\n    <option value="active" selected>活跃(默认)</option>'
);

// Handle "active" filter in render
newHtml = newHtml.replace(
  'if (filterType && m.type !== filterType) return false;',
  'if (filterType === "active" && m.type === "deprecated") return false;\n    else if (filterType && filterType !== "active" && m.type !== filterType) return false;'
);

writeFileSync("models/dashboard.html", newHtml);

console.log(`Updated: ${MODELS.length} models (was ${idCount})`);
console.log(`  domestic=${MODELS.filter(m=>m.type==='domestic').length} international=${MODELS.filter(m=>m.type==='international').length} deprecated=${MODELS.filter(m=>m.type==='deprecated').length}`);
console.log(`  confirmed=${MODELS.filter(m=>m.dataStatus==='confirmed').length} partial=${MODELS.filter(m=>m.dataStatus==='partial').length} unverified=${MODELS.filter(m=>m.dataStatus==='unverified').length}`);