# 常用命令行工具速查

这份文档整理了一些常用命令行工具的基本用法，并标注它们通常是系统自带还是需要额外安装。

## 安装情况总览

| 工具 | 主要用途 | 通常是否自带 |
| --- | --- | --- |
| `grep` | 搜索文本 | Linux/macOS 通常自带，Windows 建议 Git Bash/WSL |
| `sed` | 文本替换和行处理 | Linux/macOS 通常自带，Windows 建议 Git Bash/WSL |
| `awk` | 按列处理文本 | Linux/macOS 通常自带，Windows 建议 Git Bash/WSL |
| `find` | 查找文件 | Linux/macOS 通常自带，Windows 建议 Git Bash/WSL |
| `cat` | 输出文件内容 | 通常自带 |
| `less` | 分页查看文件 | Linux/macOS 通常自带 |
| `head` | 查看文件开头 | 通常自带 |
| `tail` | 查看文件末尾/实时日志 | 通常自带 |
| `sort` | 排序 | 通常自带 |
| `uniq` | 去重/统计重复 | 通常自带 |
| `wc` | 统计行数、单词数、字节数 | 通常自带 |
| `cut` | 按列截取文本 | 通常自带 |
| `tr` | 字符替换/删除 | 通常自带 |
| `xargs` | 把输入转换为命令参数 | 通常自带 |
| `tar` | 打包和解压 | 通常自带 |
| `curl` | HTTP 请求/下载文件 | 多数系统自带，Windows 10+ 通常也有 |
| `jq` | 处理 JSON | 通常需要安装 |
| `yq` | 处理 YAML | 通常需要安装 |
| `rg` / `ripgrep` | 快速搜索文本和代码 | 通常需要安装 |
| `fd` | 更现代的文件查找工具 | 通常需要安装 |
| `fzf` | 终端模糊搜索 | 通常需要安装 |
| `bat` | 更好看的 `cat` | 通常需要安装 |
| `eza` | 更现代的 `ls` | 通常需要安装 |
| `htop` | 交互式进程查看器 | 通常需要安装 |

> 说明：Windows 原生 CMD/PowerShell 的命令和 Unix 命令不同。如果想使用 Linux 风格工具，建议安装 Git Bash、WSL、MSYS2，或者用 `winget` / `scoop` 安装现代工具。

---

## 安装方式示例

### macOS

```bash
brew install ripgrep fd jq yq fzf bat eza
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install ripgrep fd-find jq fzf bat
```

`yq` 可以使用 snap 或下载二进制：

```bash
sudo snap install yq
```

### Windows

使用 `winget`：

```powershell
winget install BurntSushi.ripgrep.MSVC
winget install sharkdp.fd
winget install jqlang.jq
winget install MikeFarah.yq
```

使用 `scoop`：

```powershell
scoop install ripgrep fd jq yq fzf bat eza
```

---

# 1. `grep`：搜索文本

用途：在文件里搜索字符串或正则表达式。

## 基本搜索

```bash
grep "hello" file.txt
```

## 递归搜索目录

```bash
grep -r "TODO" .
```

## 显示行号

```bash
grep -n "error" app.log
```

## 忽略大小写

```bash
grep -i "warning" app.log
```

## 显示上下文

```bash
grep -C 3 "Exception" app.log
```

只显示匹配之后 5 行：

```bash
grep -A 5 "start" app.log
```

只显示匹配之前 5 行：

```bash
grep -B 5 "failed" app.log
```

## 排除目录

```bash
grep -r "foo" . --exclude-dir=node_modules --exclude-dir=.git
```

## 常用选项

| 选项 | 说明 |
| --- | --- |
| `-i` | 忽略大小写 |
| `-n` | 显示行号 |
| `-r` | 递归搜索 |
| `-v` | 反向匹配 |
| `-E` | 使用扩展正则 |
| `-C` | 显示上下文 |
| `-A` | 显示匹配之后的行 |
| `-B` | 显示匹配之前的行 |

---

# 2. `rg` / `ripgrep`：更快的代码搜索工具

用途：快速搜索代码和文本，通常比 `grep -r` 更适合代码项目。

通常需要安装。

## 基本搜索

```bash
rg "TODO"
```

## 指定目录搜索

```bash
rg "useEffect" src
```

## 忽略大小写

```bash
rg -i "token"
```

## 搜索指定文件类型

```bash
rg "interface" -t ts
rg "func" -t go
rg "class" -t py
```

## 只列出匹配文件名

```bash
rg -l "TODO"
```

## 只列出不匹配的文件

```bash
rg -L "license"
```

## 搜索隐藏文件

```bash
rg --hidden "secret"
```

## 不遵守 `.gitignore`

```bash
rg -u "node_modules"
```

## 完全不忽略任何文件

```bash
rg -uuu "something"
```

## 替换预览

```bash
rg "oldName" -r "newName"
```

## 特点

- 默认递归搜索当前目录。
- 默认遵守 `.gitignore`。
- 默认跳过二进制文件、隐藏目录、`.git` 等。
- 比 `grep -r` 更快，更适合代码库搜索。

---

# 3. `sed`：文本替换和行处理

用途：替换、删除、提取文本行。

通常系统自带。

## 替换每行第一个匹配

```bash
sed 's/foo/bar/' file.txt
```

## 替换每行所有匹配

```bash
sed 's/foo/bar/g' file.txt
```

## 原地修改文件

Linux：

```bash
sed -i 's/foo/bar/g' file.txt
```

macOS：

```bash
sed -i '' 's/foo/bar/g' file.txt
```

## 打印第 10 行

```bash
sed -n '10p' file.txt
```

## 打印第 10 到 20 行

```bash
sed -n '10,20p' file.txt
```

## 删除空行

```bash
sed '/^$/d' file.txt
```

## 删除包含关键词的行

```bash
sed '/debug/d' file.txt
```

## 常见模式

| 用法 | 说明 |
| --- | --- |
| `s/旧/新/` | 替换每行第一个匹配 |
| `s/旧/新/g` | 替换每行所有匹配 |
| `-n 'Np'` | 打印第 N 行 |
| `'/模式/d'` | 删除匹配行 |
| `-i` | 原地修改文件 |

---

# 4. `awk`：按列处理文本

用途：处理表格、日志、空格分隔文本。

通常系统自带。

## 打印第一列

```bash
awk '{print $1}' file.txt
```

## 打印第一列和第三列

```bash
awk '{print $1, $3}' file.txt
```

## 按逗号分隔 CSV

```bash
awk -F',' '{print $1, $2}' data.csv
```

## 过滤第三列大于 100 的行

```bash
awk '$3 > 100 {print $0}' file.txt
```

## 统计第二列总和

```bash
awk '{sum += $2} END {print sum}' file.txt
```

## 常见变量

| 变量 | 说明 |
| --- | --- |
| `$0` | 整行 |
| `$1` | 第一列 |
| `$2` | 第二列 |
| `NF` | 当前行字段数 |
| `NR` | 当前行号 |
| `-F` | 指定分隔符 |

---

# 5. `find`：查找文件

用途：按文件名、类型、大小、修改时间查找文件。

Linux/macOS 通常自带。Windows 的 `find` 不是同一个工具，建议使用 Git Bash/WSL。

## 按文件名查找

```bash
find . -name "*.js"
```

## 忽略大小写

```bash
find . -iname "*.jpg"
```

## 只查找文件

```bash
find . -type f -name "*.log"
```

## 只查找目录

```bash
find . -type d -name "node_modules"
```

## 查找大文件

```bash
find . -type f -size +100M
```

## 查找最近 7 天修改过的文件

```bash
find . -type f -mtime -7
```

## 删除 `.log` 文件

谨慎使用：

```bash
find . -type f -name "*.log" -delete
```

## 对查找到的文件执行命令

```bash
find . -type f -name "*.txt" -exec grep "hello" {} \;
```

---

# 6. `fd`：更好用的文件查找工具

用途：现代版 `find`，语法更简单。

通常需要安装。

## 查找文件名包含 `config`

```bash
fd config
```

## 查找 `.ts` 文件

```bash
fd -e ts
```

## 查找目录

```bash
fd node_modules -t d
```

## 查找文件

```bash
fd README -t f
```

## 包含隐藏文件

```bash
fd --hidden env
```

## 不遵守 `.gitignore`

```bash
fd --no-ignore target
```

## 对结果执行命令

```bash
fd -e log -x rm
```

## 特点

- 默认递归。
- 默认彩色输出。
- 默认遵守 `.gitignore`。
- 语法比 `find` 更简单。

---

# 7. `jq`：处理 JSON

用途：格式化、查询、过滤、转换 JSON。

通常需要安装。

## 格式化 JSON

```bash
cat data.json | jq
```

也可以：

```bash
jq '.' data.json
```

## 取字段

```bash
jq '.name' data.json
```

## 取嵌套字段

```bash
jq '.user.email' data.json
```

## 取数组第一项

```bash
jq '.[0]' data.json
```

## 遍历数组字段

```bash
jq '.users[].name' data.json
```

## 过滤数组

```bash
jq '.users[] | select(.age > 18)' data.json
```

## 输出纯文本，不带引号

```bash
jq -r '.name' data.json
```

## 修改字段

```bash
jq '.name = "Alice"' data.json
```

## 组合字段输出

```bash
jq '.users[] | "\(.name): \(.email)"' data.json
```

## 常用模式

| 用法 | 说明 |
| --- | --- |
| `.` | 当前 JSON |
| `.name` | 取字段 |
| `.users[]` | 遍历数组 |
| `select(...)` | 过滤 |
| `-r` | 输出原始字符串 |

---

# 8. `yq`：处理 YAML

用途：类似 `jq`，但用于 YAML。常见版本是 Mike Farah 的 Go 版本。

通常需要安装。

## 读取字段

```bash
yq '.name' config.yaml
```

## 读取嵌套字段

```bash
yq '.server.port' config.yaml
```

## 修改字段

```bash
yq '.server.port = 8080' config.yaml
```

## 原地修改

```bash
yq -i '.server.port = 8080' config.yaml
```

## 读取数组

```bash
yq '.services[].name' docker-compose.yml
```

## 转 JSON

```bash
yq -o=json '.' config.yaml
```

> 注意：`yq` 有多个实现，不同实现语法可能不同。本文以 Mike Farah 的 `yq` 为主。

---

# 9. `xargs`：把输入变成命令参数

用途：把管道输出传给另一个命令。

通常系统自带。

## 删除所有 `.log` 文件

```bash
find . -name "*.log" | xargs rm
```

## 更安全地处理特殊文件名

```bash
find . -name "*.log" -print0 | xargs -0 rm
```

## 批量搜索

```bash
fd -e js | xargs grep "TODO"
```

## 每次只传一个参数

```bash
cat urls.txt | xargs -n 1 curl -I
```

---

# 10. `curl`：发送 HTTP 请求

用途：请求接口、下载文件、调试 HTTP。

多数系统自带，Windows 10+ 通常也有 `curl.exe`。

## GET 请求

```bash
curl https://example.com
```

## 显示响应头

```bash
curl -I https://example.com
```

## POST JSON

```bash
curl -X POST https://api.example.com/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
```

## 保存到文件

```bash
curl -o file.zip https://example.com/file.zip
```

## 跟随重定向

```bash
curl -L https://example.com
```

## 带 Token 请求

```bash
curl -H "Authorization: Bearer TOKEN" https://api.example.com/me
```

---

# 11. `cat` / `less` / `head` / `tail`：查看文件

通常系统自带。

## 输出整个文件

```bash
cat file.txt
```

## 分页查看

```bash
less file.txt
```

## 查看前 20 行

```bash
head -n 20 file.txt
```

## 查看后 50 行

```bash
tail -n 50 app.log
```

## 实时查看日志

```bash
tail -f app.log
```

---

# 12. `sort` / `uniq` / `wc`：排序、去重、统计

通常系统自带。

## 排序

```bash
sort names.txt
```

## 去重

通常先排序：

```bash
sort names.txt | uniq
```

## 统计重复次数

```bash
sort names.txt | uniq -c
```

## 按数量倒序

```bash
sort names.txt | uniq -c | sort -nr
```

## 统计行数

```bash
wc -l file.txt
```

## 统计单词数

```bash
wc -w file.txt
```

## 统计字节数

```bash
wc -c file.txt
```

---

# 13. `cut` / `tr`：简单文本处理

通常系统自带。

## 按逗号分隔取第一列

```bash
cut -d',' -f1 data.csv
```

## 取第一和第三列

```bash
cut -d',' -f1,3 data.csv
```

## 小写转大写

```bash
echo "hello" | tr 'a-z' 'A-Z'
```

## 把空格替换成换行

```bash
echo "a b c" | tr ' ' '\n'
```

## 删除 Windows 回车符

```bash
tr -d '\r' < windows.txt > unix.txt
```

---

# 14. `tar`：打包和解压

通常系统自带。

## 打包目录

```bash
tar -czf archive.tar.gz mydir
```

## 解压

```bash
tar -xzf archive.tar.gz
```

## 查看压缩包内容

```bash
tar -tzf archive.tar.gz
```

## 常见参数

| 参数 | 说明 |
| --- | --- |
| `-c` | 创建压缩包 |
| `-x` | 解压 |
| `-t` | 查看内容 |
| `-z` | 使用 gzip |
| `-f` | 指定文件名 |
| `-v` | 显示过程 |

---

# 15. `fzf`：终端模糊搜索

用途：在终端里交互式选择文件、命令输出、搜索结果。

通常需要安装。

## 从文件列表中选择

```bash
find . -type f | fzf
```

## 配合编辑器

```bash
vim $(fzf)
```

## 配合 `rg`

```bash
rg -n "TODO" | fzf
```

---

# 16. `bat`：更好看的 `cat`

用途：查看文件，带语法高亮和行号。

通常需要安装。

```bash
bat file.txt
bat package.json
bat src/main.ts
```

---

# 17. `eza`：更现代的 `ls`

用途：列出目录内容，显示更友好。

通常需要安装。

```bash
eza
```

显示详细信息：

```bash
eza -la
```

树形显示：

```bash
eza --tree
```

---

# 常用组合示例

## 搜索代码

```bash
rg "function login" src
```

## 找出所有大文件

```bash
find . -type f -size +100M
```

## JSON 接口取字段

```bash
curl -s https://api.example.com/user | jq '.name'
```

## 查找所有 `.ts` 文件并搜索关键词

```bash
fd -e ts | xargs rg "UserService"
```

## 统计日志里出现最多的 IP

```bash
awk '{print $1}' access.log | sort | uniq -c | sort -nr | head
```

## 批量替换文件内容

Linux：

```bash
rg -l "oldName" | xargs sed -i 's/oldName/newName/g'
```

macOS：

```bash
rg -l "oldName" | xargs sed -i '' 's/oldName/newName/g'
```

---

# 推荐学习顺序

1. `grep` / `rg`：搜索文本和代码
2. `find` / `fd`：查找文件
3. `sed`：替换文本
4. `awk`：处理列和日志
5. `jq` / `yq`：处理 JSON/YAML
6. `xargs`：批量执行命令
7. `curl`：调接口
8. `sort` / `uniq` / `wc`：统计分析

如果主要是写代码，建议优先安装：

```bash
rg fd jq yq fzf bat
```
