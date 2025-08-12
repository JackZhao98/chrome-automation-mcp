# Chrome Automation MCP

*Read this document in English: [README.md](README.md)*

一个使用 Playwright 控制 Chrome 浏览器并执行自定义脚本的模型上下文协议（MCP）服务器。

[![npm version](https://badge.fury.io/js/chrome-automation-mcp.svg)](https://badge.fury.io/js/chrome-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能特性

- 🚀 以编程方式启动和控制 Chrome 浏览器
- 🔗 通过调试端口连接到现有的 Chrome 实例
- 📱 **智能标签页管理** - 自动切换到新标签页，处理弹窗窗口
- 🎯 **智能元素查找** - 元素不可见时自动滚动查找
- 📝 执行自定义 JavaScript 脚本，可访问浏览器和页面对象
- 🔧 **20个精简工具** - 消除冗余，更清洁的API
- 🎪 丰富的浏览器自动化（点击、输入、滚动、截图、导航）
- 📦 轻松集成 Claude Desktop 和其他 MCP 客户端

## 安装

### 从 GitHub 安装

```bash
# 克隆代码库
git clone https://github.com/JackZhao98/chrome-automation-mcp.git
cd chrome-automation-mcp

# 安装依赖
npm install

# 可选：全局安装
npm install -g .
```

### 从 npm 安装

```bash
npm install -g chrome-automation-mcp
```

**系统要求：**
- **仅支持 macOS**（macOS 10.15 或更高版本）
- **必须安装 Google Chrome**（从 [chrome.google.com](https://chrome.google.com) 下载）

**安装位置：**
- **macOS**: `/usr/local/lib/node_modules/chrome-automation-mcp`

查找全局安装路径：
```bash
npm root -g
```

## 使用方法

### 作为 MCP 服务器

#### 步骤 1：安装包
选择上述安装方法之一。

#### 步骤 2：配置 MCP 客户端

1. **找到您的 MCP 客户端配置文件：**
   - **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **其他 MCP 客户端**: 请参考您的客户端文档

2. **添加服务器配置：**

**选项 A：通过 npm 全局安装：**
```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "chrome-automation-mcp"
    }
  }
}
```

**选项 B：从 GitHub 克隆：**
```json
{
  "mcpServers": {
    "chrome-automation": {
      "command": "node",
      "args": ["/absolute/path/to/chrome-automation-mcp/bin/cli.js"]
    }
  }
}
```

#### 步骤 3：重启 MCP 客户端
关闭并重新启动您的 MCP 客户端使配置生效。

#### 步骤 4：验证安装
在您的 MCP 客户端中，您现在应该能够使用浏览器自动化命令，如：
- "启动浏览器并访问 google.com"
- "对当前页面截图"
- "点击搜索按钮"

### 编程使用

```javascript
const { ChromeAutomationServer, createServer } = require('chrome-automation-mcp');

// 方法 1：使用便利函数
const server = createServer();
server.run();

// 方法 2：手动创建实例
const server = new ChromeAutomationServer();
server.run();
```

## 可用工具（20个核心工具）

*从24个工具精简为20个核心工具，消除冗余的同时保持完整功能。*

**最新改进：**
- ✅ 移除冗余工具（`click_visible`、`find_*` 函数、`get_current_url`）
- ✅ 增强错误消息，提供可操作的建议
- ✅ 添加智能标签页切换以处理弹窗
- ✅ 改进元素可见性检测和自动滚动

### 🚀 浏览器管理（3个工具）
- `launch_browser` - 启动带调试端口的 Chrome
- `connect_browser` - 连接到现有的 Chrome 实例  
- `close_browser` - 关闭浏览器连接

### 📍 导航（2个工具）
- `navigate_to` - 导航到指定 URL
- `go_back` - 返回到浏览器历史记录的上一页

### 🎯 页面交互（4个工具）
- `click` - 点击元素（通过选择器或文本，带自动可见性检测）
- `type_text` - 在输入字段中输入文本
- `press_key` - 按下带修饰符的键盘按键
- `scroll` - 滚动页面以查找当前不可见的元素

### 📊 信息收集（3个工具）
- `get_elements` - 获取元素信息和属性（替代 find_buttons/find_links/find_inputs）
- `read_text` - 从页面/元素读取文本内容
- `get_page_info` - 获取当前页面信息（包含 URL、标题、视口等）

### ⏳ 状态与时机（2个工具）
- `wait_for` - 等待元素/条件（需要时自动切换到新标签页）
- `screenshot` - 截取页面屏幕截图

### 🖥️ 标签页管理（3个工具）
- `switch_to_latest_tab` - 切换到最近打开的标签页
- `switch_to_tab` - 通过索引或 URL 切换到特定标签页
- `get_tabs` - 获取所有打开标签页的信息

### 💻 代码执行（3个工具）
- `run_script` - 执行外部 JavaScript 文件，可访问浏览器/页面对象
- `execute_code` - 在 Node.js 上下文中执行 Playwright 代码
- `evaluate` - 在浏览器上下文中执行 JavaScript

## 快速开始示例

1. **启动浏览器**
```json
{
  "tool": "launch_browser",
  "arguments": {
    "headless": false,
    "debugPort": 9222
  }
}
```

2. **导航到网站**
```json
{
  "tool": "navigate_to",
  "arguments": {
    "url": "https://example.com"
  }
}
```

3. **截取屏幕截图**
```json
{
  "tool": "screenshot",
  "arguments": {
    "fullPage": true
  }
}
```

## 高级功能

### 智能标签页处理
`wait_for` 工具会在找不到元素时自动检测并切换到新标签页：

```json
{
  "tool": "click", 
  "arguments": {"selector": "a[target='_blank']"}
}
// 打开新标签页

{
  "tool": "wait_for",
  "arguments": {"selector": ".new-page-content"}
}
// 自动切换到新标签页并等待元素
```

### 智能元素查找
工具会在元素不可见时提供有用的指导：

```json
{
  "tool": "click",
  "arguments": {"selector": ".button-at-bottom"}
}
// 如果找不到元素："尝试使用 'scroll' 工具向下滚动..."
```

## 脚本开发

**两种执行自定义代码的方式：**

### 1. 外部脚本文件 (`run_script`)
创建一个 `.js` 文件并通过 MCP 执行：

```javascript
// my-automation-script.js
const searchQuery = args.query || 'MCP 服务器';

// 导航到 Google
await page.goto('https://google.com');

// 搜索
await page.fill('input[name="q"]', searchQuery);
await page.keyboard.press('Enter');

// 等待结果（需要时自动切换到新标签页）
await page.waitForSelector('h3');

// 获取所有结果
const results = await page.$$eval('h3', els => 
  els.map(el => el.textContent)
);

return { 
  query: searchQuery,
  searchResults: results,
  count: results.length
};
```

然后使用：`{"tool": "run_script", "arguments": {"scriptPath": "./my-automation-script.js", "args": {"query": "playwright 自动化"}}}`

### 2. 内联代码 (`execute_code`)
直接执行代码而无需创建文件：

```javascript
// 直接代码执行
await page.goto('https://google.com');
await page.fill('input[name="q"]', 'MCP 服务器');
await page.keyboard.press('Enter');
await page.waitForSelector('h3');
return await page.$$eval('h3', els => els.map(el => el.textContent));
```

**两种方法都可以访问：**
- `browser` - Playwright 浏览器实例  
- `page` - 当前页面对象
- `args` - 传递的参数（仅限 run_script）

## 配置选项

### 启动浏览器选项
- `headless`（布尔值）- 以无头模式运行（默认：false）
- `userDataDir`（字符串）- Chrome 用户数据目录
- `debugPort`（数字）- 远程调试端口（默认：9222）

### 工具特定选项
大多数工具支持：
- `timeout` - 操作超时时间（毫秒）
- `force` - 即使元素不可见也强制执行操作
- `selector` - 用于元素定位的 CSS 选择器

## 集成示例

### 与 Claude Desktop 集成

1. 克隆和安装：按照上述安装说明操作
2. 使用绝对路径添加到 Claude Desktop 配置
3. 重启 Claude Desktop
4. 使用自然语言控制浏览器！

示例对话：
> "请打开 Google，搜索 'MCP 服务器'，然后截取屏幕截图"

### 自定义 MCP 客户端

```javascript
const { spawn } = require('child_process');

const mcpServer = spawn('chrome-automation-mcp');

// 通过 stdin 发送 MCP 请求
// 通过 stdout 处理响应
```

## 故障排除

### 常见问题

1. **连接失败**
   - 确保 Chrome 允许远程调试
   - 检查端口是否已被占用
   - 验证防火墙设置

2. **找不到元素**
   - **新功能**：工具现在会自动建议使用 `scroll` 当元素不可见时
   - **新功能**：`click` 工具会在失败前自动尝试滚动一次
   - 在与元素交互前使用 `wait_for`
   - 检查元素是否在正确的框架/上下文中
   - 尝试不同的选择器策略

3. **新标签页问题** 
   - **已修复**：`wait_for` 自动切换到新标签页
   - 使用 `get_tabs` 查看所有打开的标签页
   - 使用 `switch_to_latest_tab` 手动切换标签页

4. **脚本执行错误**
   - 验证 JavaScript 语法  
   - 检查变量名的拼写错误
   - 在脚本中添加错误处理

### 调试模式

使用调试日志启动：
```bash
DEBUG=chrome-automation-mcp chrome-automation-mcp
```

## 贡献

1. Fork 代码库
2. 创建功能分支：`git checkout -b feature-name`
3. 提交更改：`git commit -am 'Add feature'`
4. 推送分支：`git push origin feature-name`
5. 提交拉取请求

## 许可证

MIT 许可证 - 详情请查看 [LICENSE](LICENSE) 文件。

## 链接

- [GitHub 代码库](https://github.com/JackZhao98/chrome-automation-mcp)
- [npm 包](https://www.npmjs.com/package/chrome-automation-mcp)
- [模型上下文协议](https://modelcontextprotocol.io/)
- [Playwright 文档](https://playwright.dev/)

---

用 ❤️ 为 MCP 生态系统构建