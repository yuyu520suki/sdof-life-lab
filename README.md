# SDOF · 半主动生活实验室

《SDOF、半主动控制与女人》v0.1：一个仅本人可见、支持手机与电脑同步的七日滚动规划网站。用明确的时间、预算和承诺约束，辅助安排自己的日常行动。

## 可以做什么

- **今日录入**：更新精力、互动事实、可用窗口、待办和实际支出。
- **七日计划**：保留科研、课程、睡眠、休息及已确认活动，在剩余窗口安排可选待办；查看原因，修改后重新校验，再手动采纳。
- **记录与趋势**：记录执行结果；有两个完整七日观察窗口后才比较互动事实，不把未知当作零。
- **设置**：配置科研和休息底线、自然周预算、七日模板，管理匿名联系人及暂停状态。
- **独立演示**：虚构 A—D 数据仅保存在当前演示会话，不写入真实云端工作区。
- **导入与导出**：严格校验版本化 JSON；导入会清除已采纳计划，并由用户确认保存。

## 技术与复用

React + TypeScript + Vinext；Sites 负责私有托管和登录，Cloudflare D1 保存按身份隔离的记录。FullCalendar 显示周日历与移动端列表，Zod 校验共享数据，Drizzle 管理数据库。

排程直接调用 **highs@1.15.3** 的 WASM MILP 求解器，运行在浏览器 Web Worker 中。时间使用整数分钟，费用使用整数分；优化限时 5 秒，Worker 10 秒看门狗。加载失败或没有可行 incumbent 时返回经过校验的规则草案。求解器报告最优与服务端验证可行性分别处理。

相关开源项目与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。原始概念研究稿保存在 [docs/concept-v0.2.md](docs/concept-v0.2.md)，其中后续算法设想不等于本版本已经实现。

## 在本机运行

需要 Node.js >=22.13.0、npm 和 Git。Windows PowerShell 可直接使用：

```powershell
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flowery_grey_gargoyle.sql
npm run dev -- --hostname 127.0.0.1
```

`db:generate` 对未改动的 schema 不会再生成迁移。上面的 SQL 只应在新的本地数据库执行一次；新版本按顺序执行尚未应用的迁移。

访问终端显示的 `http://127.0.0.1:5173/`，点击登录。模板仅在本机开发模式提供模拟身份，生产构建由 Sites 验证真实身份。首次真实工作区为空；先配置底线和周模板，或切换独立虚构演示。

`npm ci` 的 postinstall 会将固定版本 WASM 与许可复制到同源静态目录，不需要另外安装求解器、Python 或 MATLAB。

## 约束与账务口径

- 时间区间为 `[start,end)`；相邻活动可以首尾相接，跨午夜活动拆为两个日历块。
- 科研和休息由已确认的保护块覆盖最低时长，缺口返回待补充；固定活动重叠返回冲突。
- 每日明确填写未知窗口时，该日不排程；没有每日覆盖时使用对应星期模板。
- 待确认活动只作提醒；采纳提出邀约的待办不会改变现实中的双方确认状态。
- 预算按上海时区、周一开始的自然周分别核算，包括本周实际支出和未记实际费用的已确认活动预估。日期过去也不会自动释放未核实预估；实际费用通过 sourceId 替换对应预估，一项活动只关联一笔合计实际费用。
- 原已采纳的可选待办会在重排时被本轮结果替换，不反复累加预算；实际已付费用始终保留在原支付周。
- 可选待办可全部不安排。未选中不代表已证明无法安排；超时不代表不可行。
- 精力是观察记录，首版不从它推断未经校准的心理状态或资源上限。

## 接口、保存与并发

- `GET /api/workspace` 返回 `{revision,data}`。
- `PUT /api/workspace` 接收 `{expectedRevision,data}`；原子版本更新，过期返回 409，保留浏览器修改以供导出或合并。
- `POST /api/plans/accept` 接收 `{sourceRevision,plan}`；服务端从当前原始记录重建约束并复核，使用同一原子版本更新。重复采纳同一份计划是幂等的。
- 身份由平台验证，API 不接受浏览器指定 ownerId；普通保存不能注入新已采纳计划。
- 单份工作区上限 1 MB。JSON 导出用于个人备份；没有附件、消息原文或第三方聊天平台集成。

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

测试包含固定冲突、未知数据、暂停联系人、自然周预算、费用替换、过去活动的预算预留、真实 WASM 超时/可行解状态、小规模穷举最优对照，以及两台设备保存/采纳竞争。测试数据全部为虚构。

## 部署与版本管理

此项目采用 Sites 的 Vinext 模板。使用 Sites 技能完成站点注册、源码推送、打包和私有部署；D1 迁移随部署应用。平台提供 `.chatgpt.site` 地址，本方案不要求自行购置服务器或域名。

生产访问策略保持 **仅站点所有者**。网站源码公开不等于个人网站或记录公开。克隆代码用于新站点时，应为自己的 Sites 实例重新注册身份，不复用此仓库 hosting.json 中的 project_id。

`.wrangler/`、`.sites-runtime/`、node_modules、构建输出、个人导出记录、环境文件和凭据均不提交。私有 Sites 源码远端与公开 GitHub 远端分别维护。

## 后续研究

KF/ADKF、LQR、线性 MPC、NN-fMPC 将在独立合成数据沙盒中逐步对照。本版本是 MPC 风格的滚动排程原型，不宣称真实心理模型或结构控制实验结论。
