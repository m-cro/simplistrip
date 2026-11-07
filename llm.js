// Runs in the page's own world (manifest "world": "MAIN") on LLM chatbot
// sites only, so it can intercept both the native `copy` event and the
// async Clipboard API calls used by the sites' "Copy" buttons.
(function () {
  const C = globalThis.__simplistripClean;
  if (!C) return;

  const isChatGPT = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(location.hostname);

  function isEditable(el) {
    return (
      el &&
      (el.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(el.tagName))
    );
  }

  // --- Manual selection copy (Ctrl/Cmd+C, context menu) --------------------
  document.addEventListener(
    "copy",
    (e) => {
      try {
        if (!e.clipboardData || isEditable(document.activeElement)) return;
        const sel = getSelection();
        if (!sel || sel.isCollapsed) return;

        const text = sel.toString();
        const box = document.createElement("div");
        for (let i = 0; i < sel.rangeCount; i++) {
          box.appendChild(sel.getRangeAt(i).cloneContents());
        }
        const before = box.innerHTML;
        C.cleanNode(box);
        const cleanedText = C.cleanText(text);
        if (cleanedText === text && box.innerHTML === before) return;

        e.preventDefault();
        e.clipboardData.setData("text/plain", cleanedText);
        e.clipboardData.setData("text/html", box.innerHTML);
      } catch (_) {}
    },
    true
  );

  // --- Copy buttons (navigator.clipboard) ----------------------------------
  const cb = navigator.clipboard;
  if (cb && window.Clipboard) {
    const proto = Clipboard.prototype;
    const origWriteText = proto.writeText;
    const origWrite = proto.write;

    if (origWriteText) {
      proto.writeText = function (text) {
        try {
          text = C.cleanText(String(text));
        } catch (_) {}
        return origWriteText.call(this, text);
      };
    }

    if (origWrite && window.ClipboardItem) {
      proto.write = function (items) {
        try {
          const wrapped = Array.from(items, (item) => {
            const data = {};
            for (const type of item.types) {
              const p = item.getType(type);
              if (type === "text/plain") {
                data[type] = p.then(async (b) => new Blob([C.cleanText(await b.text())], { type }));
              } else if (type === "text/html") {
                data[type] = p.then(async (b) => new Blob([C.cleanHtml(await b.text())], { type }));
              } else {
                data[type] = p;
              }
            }
            return new ClipboardItem(data);
          });
          return origWrite.call(this, wrapped);
        } catch (_) {
          return origWrite.call(this, items);
        }
      };
    }
  }

  // --- ChatGPT: scrub citation markers from the rendered response ----------
  if (isChatGPT) {
    let queued = false;
    function scrub() {
      queued = false;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walker.nextNode()) {
        if (C.hasCitations(walker.currentNode.data)) hits.push(walker.currentNode);
      }
      for (const n of hits) n.data = C.cleanCitations(n.data);
    }
    function schedule() {
      if (!queued) {
        queued = true;
        requestAnimationFrame(scrub);
      }
    }
    const start = () => {
      new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      schedule();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
