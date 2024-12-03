import { LocalPdfManager } from "mozilla/pdf.js/src/core/pdf_manager.js";
import { isDict, Ref } from "mozilla/pdf.js/src/core/primitives.js";
import { stringToPDFString } from "mozilla/pdf.js/src/shared/util.js";

function t(tagName, ...contents) {
  const el = document.createElement(tagName);
  for (const x of contents) {
    if (x instanceof Node || typeof x !== "object") el.append(x);
    else Object.assign(el, x);
  }
  return el;
}

function chunkSize(len) {
  if (len <= 100) return 1;
  if (len <= 10_000) return 100;
  if (len <= 1_000_000) return 10_000;
  if (len <= 100_000_000) return 1_000_000;
  if (len <= 10_000_000_000) return 100_000_000;
  throw new RangeError("Invalid array length");
}

function showObjId(x) {
  return t("var", { className: "ref" }, x.objId);
}

const _escapeMap = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "(": "\\(",
  ")": "\\)",
  "\\": "\\\\",
  "\xa0": "⍽",
  "\x20": "␣",
};

function escapeChar(c) {
  c = _escapeMap[c] ?? ("\\" + c.charCodeAt(0).toString(8).padStart(3, "0"));
  return t("samp", c);
}

function escapeString(s) {
  const fr = document.createDocumentFragment();
  for (
    const match of s.matchAll(
      /([\0-\x19\x7f-\x9f()\\\x20\xa0])|([^\0-\x19\x7f-\x9f()\\\x20\xa0]*)/g,
    )
  ) {
    if (match[1]) {
      fr.append(escapeChar(match[1]), "\u200b");
    } else if (match[2]) {
      fr.append(match[2]);
    }
  }
  return fr;
}

function showPrimitive(x) {
  if (typeof x === "object" && x && "name" in x) {
    return t("var", { className: "name" }, escapeString(x.name));
  } else if (typeof x === "string") {
    x = stringToPDFString(x);
    x = escapeString(x);
    return t("q", x);
    return q;
  } else if (x === null) {
    return t("var", { className: "null" }, "null");
  } else {
    return t("var", { className: typeof x }, x);
  }
}

function createExpander(label, createContents, closeBehavior = 2) {
  if (typeof createContents !== "function") throw new TypeError();
  const result = t("details", t("summary", label));
  switch (closeBehavior) {
    case 1:
      once(result, "toggle").then((event) =>
        event.target.append(createContents())
      );
      setSuspend(result);
      break;
    case 2:
      result.addEventListener("toggle", (event) => {
        if (event.newState === "open") {
          event.target.append(createContents());
        } else {
          yankDetails(event.target);
        }
      });
      break;
    default:
      throw new TypeError();
  }
  return result;
}

createExpander.SUSPEND = 1;
createExpander.CLEAR = 2;

// Remove and return all children but the first summary
function yankDetails(details) {
  let fr;
  const n = [...details.childNodes];
  if (n.some((d) => d.tagName === "SUMMARY")) {
    n.splice(n.findIndex((d) => d.tagName === "SUMMARY"), 1);
  }
  if (!n.length) return null;
  fr = document.createDocumentFragment();
  fr.append(...n);
  return fr;
}

// Make this details element erase its children when closed
function setClear(details) {
  details.addEventListener("toggle", (event) => {
    if (event.newState === "closed") yankDetails(details);
  });
}

// Make this details element temporarily remove its children while closed
function setSuspend(details) {
  let suspend;
  details.addEventListener("toggle", (event) => {
    if (event.newState === "open" && suspend) {
      details.append(suspend);
      suspend = null;
    } else if (event.newState === "closed" && !suspend) {
      suspend = yankDetails(details);
    }
  });
}

function once(target, type, options) {
  options = { ...options ?? {}, once: true };
  const result = Promise.withResolvers();
  target.addEventListener(type, result.resolve, options);
  options.signal?.addEventListener("abort", result.reject);
  return result.promise;
}

function Browser(xref, root = undefined) {
  function showArray(array, label) {
    return createExpander(label, () => {
      return t("div", { className: "array" }, showManyItems(array));
    });
  }

  function showArrayChunk(array, label) {
    return createExpander(label, () => {
      return t("div", { className: "chunk" }, showManyItems(array));
    });
  }

  function showDict(dict, label) {
    return createExpander(label, () => {
      return t("div", { className: "dict" }, showManyItems(dict));
    });
  }

  function showManyItems(kv) {
    kv = [...kv];
    if (kv.length === 1) {
      return showDictItems(kv);
    }
    const fr = document.createDocumentFragment();
    if (!kv.length) return fr;
    const c = chunkSize(kv.length);
    let start = 0;
    while (kv.length >= c || kv.length > 1) {
      const chunk = kv.splice(0, c);
      if (chunk.length > 1) {
        const ix = [chunk[0][0], chunk.at(-1)[0]];
        const label = document.createDocumentFragment();
        if (typeof ix[0] === "number") {
          label.append(ix.join(" … "));
        } else {
          label.append(
            showPrimitive({ name: ix[0] }),
            " … ",
            showPrimitive({ name: ix[1] }),
          );
        }
        fr.append(showArrayChunk(chunk, label));
      } else {
        fr.append(showDictItems(chunk));
      }
      start += c;
    }
    fr.append(showManyItems(kv));
    return fr;
  }

  function showDictItems(dict) {
    const fr = document.createDocumentFragment();
    for (const [k, v] of dict) {
      const obj = v instanceof Ref ? xref.fetch(v) : v;
      const key = document.createDocumentFragment();
      if (typeof k === "number") {
        key.append(t("ins", k + "."));
      } else {
        key.append(showPrimitive({ name: k }));
      }
      key.append("\u2001");
      if (obj?.objId) key.append(" ", showObjId(obj));
      let row;
      if (isDict(obj)) {
        key.append(" ", t("ins", "dict"));
        row = showDict(obj, key);
      } else if (isDict(obj?.dict)) { // stream
        const stream = obj.stream ?? obj.str ?? obj;
        const length = stream.maybeLength ?? stream.length;
        key.append(showObjId(obj.dict), " ", t("ins", `${length} bytes`));
        row = showStreamClosed(obj, key);
      } else if (Array.isArray(obj)) {
        key.append(t("ins", `Array(${obj.length})`));
        row = showArray([...obj.entries()], key);
      } else {
        row = t("div", key, showPrimitive(obj));
      }
      fr.append(row);
    }
    return fr;
  }

  function showStreamClosed(obj, label) {
    const memo = {};
    return createExpander(label, () => {
      const fr = document.createDocumentFragment();
      const div = t("div", { className: "dict" }, showManyItems(obj.dict));
      fr.append(div, showStreamExpander(obj, memo));
      return fr;
    });
  }

  function showStreamExpander(obj, memo) {
    return createExpander("stream data", () => showStreamData(obj, memo));
  }

  function showStreamData(obj, memo) {
    if (!memo.txt) {
      let buf = obj.getBytes();
      if (buf.length === 0) buf = obj.bytes; /* ??? */
      memo.txt = new TextDecoder("l1").decode(buf);
    }
    return t("pre", t("span", memo.txt));
  }

  if (arguments.length < 2) {
    return showDict(xref.trailer, "trailer");
  } else {
    const ref = Ref.fromString(root);
    const obj = xref.fetch(ref);
    return showDict(obj, ref);
  }
}

function createDocument(buf) {
  const manager = new LocalPdfManager({
    source: buf,
    evaluatorOptions: {},
  });

  const doc = manager.pdfDocument;
  doc.parseStartXRef();
  doc.parse();
  Object.assign(doc, {
    obj(refStr) {
      return this.xref.fetch(Ref.fromString(refStr));
    },
  });
  return doc;
}

function createBrowser(pdfDocument, root = undefined) {
  const xref = pdfDocument.xref;
  let result;
  if (arguments.length < 2) {
    result = new Browser(xref);
  } else {
    result = new Browser(xref, root);
  }
  result.open = true;
  keyEvents(result);
  return result;
}

function xpath1(expression, contextNode) {
  return (contextNode?.ownerDocument ?? document).evaluate(
    expression,
    contextNode ?? document,
    null,
    XPathResult.ANY_UNORDERED_NODE_TYPE,
  ).singleNodeValue;
}

Object.assign(globalThis, { xpath1 });

function* xpath(expression, contextNode) {
  const result = (contextNode?.ownerDocument ?? document).evaluate(
    expression,
    contextNode ?? document,
    null,
  );
  while (true) {
    const a = result.iterateNext();
    if (!a) break;
    yield a;
  }
}

function keyEvents(ele) {
  ele.addEventListener("keydown", function (event) {
    if (!(event.target.parentElement instanceof HTMLDetailsElement)) return;
    const details = event.target.parentElement;
    switch (event.key) {
      case "ArrowRight":
        if (!details.open) {
          event.preventDefault();
          event.target.click();
        } else {
          const next = xpath1("following::summary", event.target);
          if (!next) return;
          event.preventDefault();
          next.focus();
        }
        break;
      case "ArrowLeft":
        if (details.open) {
          event.preventDefault();
          event.target.click();
        } else {
          const prev = xpath1("../ancestor::details/summary", event.target);
          if (!prev) return;
          event.preventDefault();
          prev.focus();
        }
        break;
      case "ArrowUp": {
        const prev = xpath1("preceding::summary", event.target);
        if (!prev) return;
        event.preventDefault();
        prev.focus();
        break;
      }
      case "ArrowDown": {
        const next = xpath1("following::summary", event.target);
        if (!next) return;
        event.preventDefault();
        next.focus();
        break;
      }
    }
  });
}

export { createBrowser, createDocument };
