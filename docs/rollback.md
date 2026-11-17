# 3.0 回滚手册

每个特性都是独立开关，关掉某一项不影响其它项；也可用 git revert 整块回退。

## 1. 运行时开关（立即生效，写 localStorage）

```js
__acConfig({ timeline: false });    // A 日期分组 / hover 预览
__acConfig({ pin: false });         // B 钉住按钮
__acConfig({ memory: false });      // B 会话记忆
__acConfig({ search: false });      // C 搜索
__acConfig({ forkchip: false });    // E 分叉徽标
__acConfig({ incremental: false }); // F 增量渲染
__acConfig({ guard: false });       // 内核 withdraw 兜底
__acConfig({ i18n: 'zh' });         // G 文案（auto|zh|en）
__acConfig({ theme: 'dark' });      // G 主题（auto|light|dark）
localStorage.removeItem('dsh-ac-config'); // 全部恢复默认
```

写死配置：`localStorage['dsh-ac-config'] = JSON.stringify({ timeline: false })`。

## 2. Git 提交对照

| 提交 | 内容 |
| --- | --- |
| `1211259` | 2.5.x 复核修复五处缺陷 + regression 场景 |
| `4abaee7` | P0：配置开关 / dispose / 多面板选流 / guard 可关 |
| `95eb39b` | F + A + B（增量渲染、时间线、记忆与钉住；三者可分别用开关关掉） |
| `47cb345` | C 搜索 |
| `19aa3e7` | E 分叉徽标 |
| `fd77a83` | G 主题/无障碍/双语 + 文档 |

```bash
git revert 47cb345   # 只退搜索
git revert 19aa3e7   # 只退分叉徽标
git revert fd77a83   # 只退 G
git revert 95eb39b   # 退 F+A+B（三种特性一起退；只想退一项请用上面的开关）
```

## 3. 数据

- 配置：`localStorage['dsh-ac-config']`
- 会话记忆：`localStorage['dsh-ac-mem:<会话键>']`（每会话一条）
- 删这两类键即回到「全新安装」状态；插件本身不写会话文件、不改 app.asar。
