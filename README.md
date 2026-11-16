# BacklinkKit

浏览器侧栏插件：管理多个产品的资料，为目录站外链提交按需生成英文简介与详述，逐项快捷复制后手动粘贴到目标目录站。

- 产品资料（网站名、域名、logo、og 封面图、邮箱）输入域名一键抓取，可随时人工修改
- 每次点「生成」都调用当前 LLM 供应商产出全新的简介与详述（markdown，内含 1~3 个指向产品域名的链接），各目录站文案不重复；字数为软约束，可在面板上切换档位（简介 150/300/500、详述 1000/2000/3000），仅引导 LLM 不做拦截
- 全部数据只存浏览器本地（IndexedDB / chrome.storage.local）

领域词汇见 [GLOSSARY.md](./GLOSSARY.md)。

## 安装

```bash
cd extension
pnpm install
pnpm build          # 产物在 extension/dist/chrome-mv3
```

Chrome 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension/dist/chrome-mv3`。点击工具栏图标打开侧栏面板。

## 配置 LLM API Key

1. 点侧栏右上角齿轮打开设置
2. 选择供应商：DeepSeek（`deepseek-v4-flash`）或 HY（`hy4-flash`），切换即启用
3. 粘贴所选供应商的 API Key（DeepSeek 的以 `sk-` 开头，[在此获取](https://platform.deepseek.com/)）
4. 点「测试连接」确认可用，再点「保存」

两家供应商的 Key 各自独立保存，随时切换；产品分析与文案生成走当前启用的供应商。Key 明文保存在浏览器本地，仅本机可读。

## 添加产品

1. 在「添加产品」输入框粘贴产品域名（带不带协议、路径、`www` 都可以，会自动规范化）
2. 点「开始添加」：插件抓取首页解析网站名 / logo / og 封面图，邮箱默认 `support@裸域名`，并调用当前 LLM 供应商分析首页内容生成「产品分析」存档
3. 抓不到的图片留空，可后续手动上传替换；同一域名不能重复添加

## 管理产品

- 切换：顶部下拉选择当前产品，选择会记住，重开面板保持
- 编辑：网站名 / URL / 邮箱行内编辑（点铅笔图标），logo / og 点图片图标上传替换（PNG/JPG/WebP/GIF/BMP，≤2MB）
- 删除：下拉旁的垃圾桶按钮删除当前产品（有确认弹窗）

## 日常使用动线

1. 打开目标目录站的提交页面
2. 在插件面板顶部下拉切换到要提交的产品
3. 按目标站的输入框限制选好简介/详述字数档位（软约束），需要新文案时点「生成」（每次都是全新调用，提示词注入随机种子保证多样性）；面板显示实际字数便于对照
4. 逐项点字段旁的复制按钮，粘贴到目录站对应的输入框（logo / og 复制的是图片本体，可直接粘贴进图片上传框或编辑器）

## 开发

```bash
cd extension
pnpm test    # Vitest：添加产品与文案生成两条管线接缝 + LLM 工具
pnpm build
pnpm zip     # 打包上架用 zip
```

架构要点：`src/lib/add-product.ts` 与 `src/lib/generate-copy.ts` 是两条纯管线（依赖注入，测试接缝）；`src/lib/prompts.ts` 内置全部提示词；存储在 `src/lib/db.ts`（IndexedDB v8，单 products store）与 `src/lib/storage.ts`（chrome.storage.local）。
