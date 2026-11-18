# CSS gadget chain finder

1. Copy all CSS on the target page by running this in the DevTools Console:

```js
copy((await Promise.all([...document.styleSheets].map(s => s.href ? fetch(s.href).then(r => r.text()) : s.ownerNode.innerText))).join('\n'))
```

2. Paste it into a file, then run this tool on it (configure by editing [index.mjs](src/index.mjs) global variables):

```sh
npm start bootstrap.css
```

3. You'll find a file created `bootstrap-output.html` next to your input CSS containing newline-delimited generated HTML matching the required CSS selectors
