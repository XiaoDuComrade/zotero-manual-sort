# Manual Sort for Zotero 9

在 Zotero 9 的普通分类中直接拖动条目，保存该分类独立的手动顺序。

## 使用

1. 安装 `zotero-manual-sort-0.1.1.xpi` 并重启 Zotero。
2. 打开左侧的一个普通分类。
3. 在中间条目列表中拖动一个或多个条目，放到目标条目的上半部或下半部。
4. 顺序会写入 Zotero 自带的 `collectionItems.orderIndex`，重新打开 Zotero 后仍会保留。

点击标题、作者、年份等表头时，列表会临时恢复为相应字段排序。再次拖动条目后，当前列表顺序会成为新的手动顺序。

分类右键菜单额外提供：

- `按手动顺序显示`
- `将当前显示顺序保存为手动顺序`

第二个命令适合先按年份、标题等字段排好，再将该顺序作为手动排序的起点。

## 安全限制

为避免意外覆盖不可见条目的位置，以下状态不会接管手动拖放：

- “我的文库”、保存的搜索、回收站等非普通分类；
- 快速搜索框中存在过滤条件；
- 已启用递归显示子分类；
- 当前分类不可编辑；
- 拖动的是父条目下面的附件或笔记。

手动顺序保存在本机 Zotero 数据库已有字段中，不修改题名、Extra、标签或附件。Zotero 官方同步协议目前不保证跨设备同步 `orderIndex`，因此不同电脑上的手动顺序可能不同。

## 构建与测试

```powershell
corepack pnpm exec vitest run --config vitest.config.ts
corepack pnpm exec zotero-plugin build
powershell -ExecutionPolicy Bypass -File scripts/verify-xpi.ps1
```

建议先用独立 Zotero 测试配置安装，并备份数据库。
