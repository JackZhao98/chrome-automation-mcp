# Browser Automation MCP

*Read this document in English: [README.md](README.md)*

一个使用 Playwright 控制 Chrome 浏览器并执行自定义脚本的模型上下文协议（MCP）服务器。

[![npm version](https://badge.fury.io/js/browser-automation-mcp.svg)](https://badge.fury.io/js/browser-automation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能特性

- 🚀 以编程方式启动和控制 Chrome 浏览器
- 🔗 通过调试端口连接到现有的 Chrome 实例
- 📝 执行自定义 JavaScript 脚本，可访问浏览器和页面对象
- 🎯 丰富的浏览器自动化工具集（点击、输入、滚动、截图等）
- 🔧 支持 CLI 和编程 API
- 📦 轻松集成 Claude Desktop 和其他 MCP 客户端

## 安装

### 从 GitHub 安装

```bash
# 克隆代码库
git clone https://github.com/JackZhao98/browser-automation-mcp.git
cd browser-automation-mcp

# 安装依赖
npm install

# 可选：全局安装
npm install -g .
```

### 从 npm 安装（即将推出）

```bash
# 发布到 npm 后可用
npm install -g browser-automation-mcp
```

## 使用方法

### 作为 MCP 服务器

在您的 MCP 客户端（例如 Claude Desktop）中配置：

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "node",
      "args": ["/absolute/path/to/browser-automation-mcp/bin/cli.js"]
    }
  }
}
```

或者如果全局安装：

```json
{
  "mcpServers": {
    "browser-automation": {
      "command": "browser-automation-mcp"
    }
  }
}
```

### 编程使用

```javascript
const { BrowserAutomationServer, createServer } = require('browser-automation-mcp');

// 方法 1：使用便利函数
const server = createServer();
server.run();

// 方法 2：手动创建实例
const server = new BrowserAutomationServer();
server.run();
```

## 可用工具

### 浏览器管理
- `launch_browser` - 启动带调试端口的 Chrome
- `connect_browser` - 连接到现有的 Chrome 实例
- `close_browser` - 关闭浏览器连接

### 导航与页面控制
- `navigate_to` - 导航到指定 URL
- `get_page_info` - 获取当前页面信息
- `screenshot` - 截取页面屏幕截图
- `scroll` - 向指定方向滚动页面

### 元素交互
- `click` - 点击元素（通过选择器或文本）
- `click_visible` - 点击第一个可见元素
- `type_text` - 在输入字段中输入文本
- `press_key` - 按下带修饰符的键盘按键

### 内容提取
- `read_text` - 从页面/元素读取文本内容
- `get_elements` - 获取元素信息和属性
- `find_buttons` - 查找页面上的所有按钮
- `find_links` - 查找页面上的所有链接
- `find_inputs` - 查找所有输入字段

### 高级操作
- `wait_for` - 等待元素/条件
- `evaluate` - 在浏览器上下文中执行 JavaScript
- `execute_code` - 在 Node.js 上下文中执行 Playwright 代码
- `run_script` - 执行外部脚本文件

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

## 脚本开发

当使用 `run_script` 或 `execute_code` 时，您可以访问：
- `browser` - Playwright 浏览器实例
- `page` - 当前页面对象
- `args` - 传递的参数对象

### 示例脚本

```javascript
// example-script.js
const searchQuery = args.query || 'default search';

// 导航到 Google
await page.goto('https://google.com');

// 搜索
await page.fill('input[name="q"]', searchQuery);
await page.press('input[name="q"]', 'Enter');

// 等待结果
await page.waitForSelector('h3');

// 获取第一个结果
const firstResult = await page.textContent('h3');

return {
  query: searchQuery,
  firstResult: firstResult
};
```

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

const mcpServer = spawn('browser-automation-mcp');

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
   - 在与元素交互前使用 `wait_for`
   - 检查元素是否在正确的框架/上下文中
   - 尝试不同的选择器策略

3. **脚本执行错误**
   - 验证 JavaScript 语法
   - 检查变量名的拼写错误
   - 在脚本中添加错误处理

### 调试模式

使用调试日志启动：
```bash
DEBUG=browser-automation-mcp browser-automation-mcp
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

- [GitHub 代码库](https://github.com/JackZhao98/browser-automation-mcp)
- [npm 包](https://www.npmjs.com/package/browser-automation-mcp)
- [模型上下文协议](https://modelcontextprotocol.io/)
- [Playwright 文档](https://playwright.dev/)

---

用 ❤️ 为 MCP 生态系统构建