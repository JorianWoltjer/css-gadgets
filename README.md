```js
copy((await Promise.all([...document.styleSheets].map(s => s.href ? fetch(s.href).then(r => r.text()) : s.ownerNode.innerText))).join('\n'))
```

```sh
npm start test/bootstrap.css
```

```sh
npm test
```
