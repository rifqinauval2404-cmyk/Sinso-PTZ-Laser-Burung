const WebSocket = require("ws");
const ws = new WebSocket(process.argv[2]);
let msgId = 1;
const pending = new Map();
function send(method, params) {
  return new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result;
}
ws.on("open", async () => {
  await send("Runtime.enable");
  const r = await evaluate(`
    (function() {
      const select = document.querySelector('.playback-io select');
      const opts = select ? [...select.options].map(o => ({value:o.value, text:o.textContent})) : "NO_SELECT";
      const numberInputs = [...document.querySelectorAll('.playback-settings input[type="number"]')].map(i => i.previousSibling ? i.previousSibling.textContent : i.parentElement.textContent);
      return JSON.stringify({ opts, numberInputs });
    })()
  `);
  console.log(JSON.stringify(r));
  process.exit(0);
});
ws.on("error", (e) => console.error("err", e.message));
