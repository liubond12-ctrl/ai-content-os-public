# AI Content OS

面向日常写作的内容工作台。在同一个输入区描述写作需求、粘贴资料或附加文件，然后查看初稿、审核意见和版本。

## 功能

- 单篇创作、批量填报和自由文章。
- 多账号写作上下文管理、账号切换与同题对比。
- 写作参考、任务资料、稿件审核、版本管理和 Markdown 导出。
- 可选的本地知识检索与飞书资料来源配置。

## 本地运行

推荐 Node.js 24。在仓库根目录执行：

```sh
npm ci
npm run dev
```

打开 [本地工作台](http://localhost:3000)。如需体验带后台生成队列的离线演示，执行：

```sh
npm run build
node scripts/start-production.mjs --demo
```

打开 [离线演示](http://127.0.0.1:3588)。演示内置虚构资料和本地模拟模型，无需 API 密钥。

使用真实生成时，在本机 `.env.local` 中填写自己的 `STUDIO_MODEL_KEY`，构建后运行 `node scripts/start-production-real.mjs`。本地知识检索可用 `python -m pip install pypdf` 和 `python scripts/index-knowledge.py` 初始化。语义检索还需要下载模型并生成向量索引，依次运行 `node scripts/download-embedding.mjs` 和 `npm run index:vectors`。

公开版的账号和附带资料均为虚构示例。实际部署时可按自己的业务资料和账号规则配置。

## 测试

初始化知识索引和向量索引后运行 `npm test`。依赖原部署历史数据库的回放测试在无该数据时会跳过。
