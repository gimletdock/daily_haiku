# 每日俳句

工作日发布 Classic 大师俳句和 Custom 原创俳句，周末两个页面展示同一款经典鸡尾酒。生成程序和网页由 TypeScript 实现，独立站和博客读取同一份三语内容。

## 本地运行

需要 Node.js 22 和 npm。

```sh
npm ci
npm test
npm run generate -- --date 2026-11-27 --offline
npm run generate -- --date 2026-11-28 --offline
npm run build
npm run preview
```

访问 `http://127.0.0.1:4173/classic/?date=2026-11-27`、`/custom/?date=2026-11-27` 或 `/custom/?date=2026-11-28` 查看三种样例。测试或预览用的离线内容可以通过 `--out` 输出到临时目录。未指定 `--date` 时，生成北京时间的次日内容。

## 发布与数据

- 两个 GET 路径是 `/api/v1/classic/YYYY-MM-DD.json` 和 `/api/v1/custom/YYYY-MM-DD.json`。二者按北京时间日期读取。周末内容一致。
- 每条记录包含 `version`、`date`、`kind`、`source` 和 `translations`。译文包含 `ja`、`zh` 和 `en`，各有三行。经典原作带 `author` 和 `sourceUrl`，周末配方带 `sourceUrl`。Custom 的 `source` 为 `model` 或 `backup`，同日重跑复用已有的有效稿。
- GitHub Actions 在北京时间 21:17 准备内容，23:43 补跑。也可手动指定日期。初次发布可手动生成当天内容。定时生成读取武汉天气预报，2026–2027 年使用已核对的节气日期，其余年份使用月份。核实过的新闻可由操作方通过 `--news FILE` 传入，格式为 `{"date":"YYYY-MM-DD","sourceUrl":"https://…","fact":"经过核实的事实"}`。
- 在 GitHub Actions Secrets 配置 `MODEL_API_KEY`。在 Actions Variables 配置 `MODEL_NAME`，可选 `MODEL_BASE_URL`。生成程序使用 OpenAI 兼容的聊天补全接口。凭据或模型名缺失时，Custom 使用有标识的备用俳句。
- 将独立 Cloudflare Pages 项目接入该仓库的 `main`。构建命令为 `npm run build`，目录为 `dist`。构建仅复制通过校验的既有 JSON。首次配置后应通过一次手动任务核对 GitHub Actions 写回的产物触发了部署。
- Hugo 使用 `HUGO_PARAMS_DAILYFEEDBASEURL` 或 `params.dailyFeedBaseURL` 指向已确认的独立站源地址。博客工作日默认日语，周末默认英语，点正文切换语言。
