# CDP Proxy API 参考

> 文件路径：`${CLAUDE_SKILL_DIR}/references/cdp-proxy-api.md`

CDP Proxy 运行在 `http://localhost:3457`，提供以下 HTTP 端点操控浏览器。
所有需要操作浏览器的端点都会自动连接 Chrome 并管理 session。

---

### 3.1 健康检查

**GET /health**

检查 Proxy 是否就绪、是否已连接 Chrome。

```bash
curl -s http://localhost:3457/health
# {"status":"ok","connected":true,"sessions":2,"chromePort":9222}
```

### 3.2 列出所有 Tab

**GET /targets**

列出 Chrome 中所有页面 tab。

```bash
curl -s http://localhost:3457/targets
# [{"targetId":"ABC123","type":"page","title":"Google","url":"https://google.com"}]
```

### 3.3 创建新后台 Tab

**GET /new?url=**

创建新的后台 tab（不切换焦点），自动等待页面加载完成。

```bash
curl -s "http://localhost:3457/new?url=https://example.com"
# {"targetId":"DEF456"}
```

- 参数 `url` 可选，默认 `about:blank`
- 返回的 `targetId` 用于后续所有操作

### 3.4 关闭 Tab

**GET /close?target=**

关闭指定 tab。

```bash
curl -s "http://localhost:3457/close?target=DEF456"
# {"success":true}
```

### 3.5 导航

**GET /navigate?target=&url=**

在指定 tab 中导航到新 URL，自动等待页面加载完成。

```bash
curl -s "http://localhost:3457/navigate?target=DEF456&url=https://example.com/contact"
# {"frameId":"...","loaderId":"..."}
```

### 3.6 后退

**GET /back?target=**

在指定 tab 中执行浏览器后退操作，自动等待加载。

```bash
curl -s "http://localhost:3457/back?target=DEF456"
# {"ok":true}
```

### 3.7 获取页面信息

**GET /info?target=**

获取页面标题、URL 和加载状态。

```bash
curl -s "http://localhost:3457/info?target=DEF456"
# {"title":"Example","url":"https://example.com","ready":"complete"}
```

### 3.8 执行 JavaScript

**POST /eval?target=**

在页面中执行 JavaScript 表达式，body 为要执行的代码。

```bash
curl -s -X POST "http://localhost:3457/eval?target=DEF456" -d 'document.querySelectorAll("a").length'
# {"value":42}
```

- 支持 `awaitPromise: true`，可执行异步表达式
- 返回 `{ value: ... }` 或 `{ error: "..." }`

### 3.9 获取页面纯文本

**GET /page-text?target=**

提取页面 body 的纯文本内容。

```bash
curl -s "http://localhost:3457/page-text?target=DEF456"
# {"text":"页面文本内容...","length":1234}
```

### 3.10 文件上传

**POST /setFiles?target=**

直接给 file input 设置本地文件路径，绕过文件对话框。body 为 JSON。

```bash
curl -s -X POST "http://localhost:3457/setFiles?target=DEF456" \
  -d '{"selector":"input[type=file]","files":["/path/to/image.png"]}'
# {"success":true,"files":1}
```

- 用于需要上传图片或附件的场景（如产品 Logo）
- 直接通过 CDP `DOM.setFileInputFiles` 设置文件，无需用户手动选择

### 3.11 点击元素

**POST /click?target=**

通过 JS 点击页面元素，body 为 CSS 选择器。

```bash
curl -s -X POST "http://localhost:3457/click?target=DEF456" -d '#submit-button'
# {"clicked":true,"tag":"BUTTON","text":"Submit"}
```

### 3.12 真实鼠标点击

**POST /clickAt?target=**

通过 CDP 模拟真实鼠标事件点击元素（可绕过反自动化检测），body 为 CSS 选择器。

```bash
curl -s -X POST "http://localhost:3457/clickAt?target=DEF456" -d 'button.cta'
# {"clicked":true,"x":350,"y":280,"tag":"BUTTON","text":"Get Started"}
```

- 先通过 JS 定位元素坐标，再通过 CDP `Input.dispatchMouseEvent` 发送真实鼠标事件
- 适用于需要用户手势才能触发的场景（如文件对话框）

### 3.13 滚动页面

**GET /scroll?target=&y=&direction=**

滚动页面，支持方向控制。

```bash
# 向下滚动 3000px
curl -s "http://localhost:3457/scroll?target=DEF456&y=3000&direction=down"
# {"value":"scrolled down 3000px"}

# 滚动到页面顶部
curl -s "http://localhost:3457/scroll?target=DEF456&direction=top"
# {"value":"scrolled to top"}

# 滚动到页面底部
curl -s "http://localhost:3457/scroll?target=DEF456&direction=bottom"
# {"value":"scrolled to bottom"}

# 向上滚动
curl -s "http://localhost:3457/scroll?target=DEF456&y=1000&direction=up"
# {"value":"scrolled up 1000px"}
```

- `y`：滚动像素数，默认 3000
- `direction`：`down`（默认）| `up` | `top` | `bottom`
- 滚动后自动等待 800ms（触发懒加载）
