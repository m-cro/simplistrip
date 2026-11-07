// Text cleaning shared by the LLM-site content script. Exposes
// globalThis.__simplistripClean = { cleanText, cleanCitations, cleanHtml, hasCitations }.
(function () {
  // --- ChatGPT citation / content-reference markers -----------------------
  // Private-use delimiters:  start,  end,  separator.
  // "entity" blocks carry a display name worth keeping; everything else
  // (cite, navlist, image_group, ...) is dropped.
  const ENTITY_RE = /entity\[\s*"(?:[^"\\]|\\.)*"\s*,\s*"((?:[^"\\]|\\.)*)"[^\]]*\]/g;
  const PUA_BLOCK_RE = /[\s\S]*?/g;
  const PUA_STRAY_RE = /[-]/g;
  const CONTENT_REF_RE = /:?contentReference\[oaicite:\d+\]\{index=\d+\}/g;
  const CITE_TOKEN_RE =
    /(?:file)?cite(?:turn\d+(?:search|news|view|image|product|file|academic|forecast|sports|finance|business|weather)\d+)+/g;
  const CITATION_TEST_RE =
    /[-]|contentReference\[oaicite|citeturn\d|filecite/;

  function hasCitations(s) {
    return CITATION_TEST_RE.test(s);
  }

  function cleanCitations(s) {
    return s
      .replace(ENTITY_RE, (_, name) => name.replace(/\\(.)/g, "$1"))
      .replace(PUA_BLOCK_RE, "")
      .replace(CONTENT_REF_RE, "")
      .replace(CITE_TOKEN_RE, "")
      .replace(PUA_STRAY_RE, "");
  }

  // --- Invisible characters ------------------------------------------------
  const INVISIBLE_RE = new RegExp(
    "[" +
      "\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E" +
      "\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F" +
      "\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF9-\\uFFFB" +
      "]|[\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}\\u{1D173}-\\u{1D17A}]",
    "gu"
  );
  // Exotic spaces -> plain space (NBSP, en/em spaces, thin space, ideographic...).
  const SPACE_RE = /[   -   　]/g;
  // Any other private-use characters left over.
  const PUA_RE = /[-]/g;

  // --- Lookalike letters ---------------------------------------------------
  const HOMOGLYPHS = {};
  function addMap(from, to) {
    for (let i = 0; i < from.length; i++) HOMOGLYPHS[from[i]] = to[i];
  }
  // Cyrillic
  addMap("асеорхуіјѕԁԛԝһӏ", "aceopxyijsdqwhl");
  addMap("АВСЕНІЈКМОРЅТХУ", "ABCEHIJKMOPSTXY");
  // Greek
  addMap("αορνιυκτχ", "aopviuktx");
  addMap("ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ", "ABEZHIKMNOPTYX");
  // Latin-script lookalikes (IPA, small caps, dotless i, ...)
  addMap("ɑıɡ", "aig");
  addMap("ᴀʙᴄᴅᴇɢʜɪᴊᴋʟᴍɴᴏᴘʀᴛᴜᴠᴡʏᴢ", "abcdeghijklmnoprtuvwyz");

  const LATIN_RE = /[A-Za-z]/;
  const LETTERISH_RE = /[\p{L}\p{M}]/u;

  // Fullwidth forms and mathematical / letterlike alphanumerics -> ASCII.
  // Only touches characters whose NFKC form is a single ASCII letter/digit,
  // so ligatures, fractions, ellipses etc. are left alone.
  function foldStyledChar(ch) {
    const cp = ch.codePointAt(0);
    const styled =
      (cp >= 0xff10 && cp <= 0xff5a) ||
      (cp >= 0x1d400 && cp <= 0x1d7ff) ||
      (cp >= 0x2100 && cp <= 0x214f) ||
      (cp >= 0x24b6 && cp <= 0x24e9) ||
      (cp >= 0x1f130 && cp <= 0x1f189);
    if (!styled) return ch;
    const n = ch.normalize("NFKC");
    return /^[A-Za-z0-9]$/.test(n) ? n : ch;
  }

  // Share of letters that are Latin; decides whether stray lone lookalikes
  // (not part of a mixed-script word) should be folded too.
  function latinRatio(s) {
    let latin = 0;
    let letters = 0;
    for (const ch of s) {
      if (LATIN_RE.test(ch)) {
        latin++;
        letters++;
      } else if (/\p{L}/u.test(ch)) {
        letters++;
      }
    }
    return letters ? latin / letters : 0;
  }

  function fixLookalikes(s, mostlyLatin) {
    // Fold fullwidth / math-styled letters first.
    s = Array.from(s, foldStyledChar).join("");
    return s.replace(/[\p{L}\p{M}]+/gu, (word) => {
      let hasLookalike = false;
      for (const ch of word) {
        if (HOMOGLYPHS[ch]) {
          hasLookalike = true;
          break;
        }
      }
      if (!hasLookalike) return word;
      // Fold when the word already mixes in real Latin letters, or when the
      // surrounding text is overwhelmingly Latin. Genuine Russian/Greek
      // words in non-Latin text are left untouched.
      if (!mostlyLatin && !LATIN_RE.test(word)) return word;
      let out = "";
      for (const ch of word) out += HOMOGLYPHS[ch] || ch;
      return out;
    });
  }

  // `context` is the text used to judge the dominant script (defaults to s).
  function cleanText(s, context) {
    if (!s) return s;
    let out = cleanCitations(s)
      .replace(SPACE_RE, " ")
      .replace(INVISIBLE_RE, "")
      .replace(PUA_RE, "");
    const ctx = context === undefined ? out : context;
    out = fixLookalikes(out, latinRatio(ctx) >= 0.8);
    return out;
  }

  // Clean an HTML string by cleaning only its text nodes.
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    cleanNode(doc.body);
    return doc.documentElement.outerHTML;
  }

  function cleanNode(root) {
    const ctx = cleanCitations(root.textContent || "");
    const walker = (root.ownerDocument || document).createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const cleaned = cleanText(n.data, ctx);
      if (cleaned !== n.data) n.data = cleaned;
    }
  }

  Object.defineProperty(globalThis, "__simplistripClean", {
    value: { cleanText, cleanCitations, cleanHtml, cleanNode, hasCitations },
    enumerable: false,
  });
})();
