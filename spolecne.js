/* Společné pro rozhovor i přehled: přihlášení, volání serveru, převod odpovědi na HTML. */
"use strict";

const C = window.SARKA || {};
const $ = (id) => document.getElementById(id);

/* ---------- Text odpovědí na HTML (vše se nejdřív zbaví značek) ---------- */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inline(t) {
  return t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
function md(src) {
  let html = "";
  let seznam = null;
  const zavri = () => {
    if (seznam) {
      html += "</" + seznam + ">";
      seznam = null;
    }
  };
  for (const surovy of esc(src).split("\n")) {
    const r = surovy.trimEnd();
    let m;
    if ((m = r.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (seznam !== "ol") { zavri(); html += "<ol>"; seznam = "ol"; }
      html += "<li>" + inline(m[1]) + "</li>";
    } else if ((m = r.match(/^\s*[-*•]\s+(.*)/))) {
      if (seznam !== "ul") { zavri(); html += "<ul>"; seznam = "ul"; }
      html += "<li>" + inline(m[1]) + "</li>";
    } else if ((m = r.match(/^#{1,4}\s+(.*)/))) {
      zavri();
      html += "<h4>" + inline(m[1]) + "</h4>";
    } else if (r.trim() === "") {
      zavri();
    } else {
      zavri();
      html += "<p>" + inline(r) + "</p>";
    }
  }
  zavri();
  return html;
}

/* ---------- Úložiště v telefonu (může být vypnuté, stránka musí běžet i bez něj) ---------- */
const Sklad = {
  cti(klic) {
    try {
      return JSON.parse(localStorage.getItem(klic));
    } catch {
      return null;
    }
  },
  uloz(klic, hodnota) {
    try {
      if (hodnota === null) localStorage.removeItem(klic);
      else localStorage.setItem(klic, JSON.stringify(hodnota));
    } catch {
      /* soukromé okno nebo plné úložiště */
    }
  },
};

/* ---------- Účet: přihlášení kódem nebo odkazem z e-mailu ---------- */
const KLIC_RELACE = "sarka.relace";
const Ucet = {
  relace: Sklad.cti(KLIC_RELACE),
  _obnova: null,

  async sluzba(cesta, telo, token) {
    const odpoved = await fetch(C.supabase + "/auth/v1/" + cesta, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: C.klic, ...(token ? { authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(telo || {}),
    });
    const data = await odpoved.json().catch(() => ({}));
    if (!odpoved.ok) throw Object.assign(new Error(data.msg || data.message || "chyba"), { status: odpoved.status });
    return data;
  },

  prijmi(data) {
    this.relace = {
      access: data.access_token,
      refresh: data.refresh_token,
      vyprsi: Date.now() + (data.expires_in || 3600) * 1000,
      email: (data.user && data.user.email) || (this.relace && this.relace.email) || "",
    };
    Sklad.uloz(KLIC_RELACE, this.relace);
  },

  zahod() {
    this.relace = null;
    Sklad.uloz(KLIC_RELACE, null);
  },

  async overKod(email, kod) {
    this.prijmi(await this.sluzba("verify", { type: "email", email, token: kod }));
  },

  async overOdkaz(otisk) {
    this.prijmi(await this.sluzba("verify", { type: "email", token_hash: otisk }));
  },

  /** Platný přístupový token, nebo null (pak je třeba se přihlásit). */
  async token(vynutit) {
    const r = this.relace;
    if (!r) return null;
    if (!vynutit && r.vyprsi - Date.now() > 60000) return r.access;
    return this.obnov(vynutit);
  },

  obnov(vynutit) {
    if (this._obnova) return this._obnova;
    const prace = async () => {
      // Jiná karta prohlížeče mohla relaci mezitím obnovit.
      const cerstva = Sklad.cti(KLIC_RELACE) || this.relace;
      if (!cerstva) return null;
      this.relace = cerstva;
      if (!vynutit && cerstva.vyprsi - Date.now() > 60000) return cerstva.access;
      try {
        this.prijmi(await this.sluzba("token?grant_type=refresh_token", { refresh_token: cerstva.refresh }));
        return this.relace.access;
      } catch (e) {
        if (e.status >= 400 && e.status < 500 && e.status !== 429) {
          this.zahod();
          return null;
        }
        throw e;
      }
    };
    const beh = navigator.locks ? navigator.locks.request("sarka-relace", prace) : prace();
    this._obnova = beh.finally(() => {
      this._obnova = null;
    });
    return this._obnova;
  },

  async odhlas() {
    const r = this.relace;
    this.zahod();
    if (r) await this.sluzba("logout?scope=local", {}, r.access).catch(() => {});
  },
};

/* ---------- Server ---------- */
class ChybaServeru extends Error {
  constructor(kod, zprava, status) {
    super(zprava);
    this.kod = kod;
    this.status = status;
  }
}

/** Volání funkce na serveru. Vrací Response, chyby převádí na ChybaServeru s českou zprávou. */
async function server(cesta, { metoda = "GET", telo, verejne = false, signal } = {}) {
  const poslat = async (token) =>
    fetch(C.api + "/" + cesta, {
      method: metoda,
      headers: {
        apikey: C.klic,
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(telo ? { "content-type": "application/json" } : {}),
      },
      body: telo ? JSON.stringify(telo) : undefined,
      signal,
    });

  let odpoved;
  try {
    if (verejne) {
      odpoved = await poslat(null);
    } else {
      let token = await Ucet.token();
      if (!token) throw new ChybaServeru("neprihlasen", "Přihlaste se prosím znovu.", 401);
      odpoved = await poslat(token);
      if (odpoved.status === 401) {
        token = await Ucet.token(true);
        if (!token) throw new ChybaServeru("neprihlasen", "Přihlaste se prosím znovu.", 401);
        odpoved = await poslat(token);
      }
    }
  } catch (e) {
    if (e instanceof ChybaServeru || e.name === "AbortError") throw e;
    throw new ChybaServeru("spojeni", "Nepovedlo se spojit. Zkontrolujte připojení a zkuste to znovu.", 0);
  }
  if (!odpoved.ok) {
    const data = await odpoved.json().catch(() => ({}));
    if (odpoved.status === 401) Ucet.zahod();
    throw new ChybaServeru(data.chyba || "server", data.zprava || "Něco se pokazilo. Zkuste to prosím znovu.", odpoved.status);
  }
  return odpoved;
}

/* ---------- Kontakt a odkazy v patě ---------- */
function kontaktHtml() {
  const k = C.kontakt || {};
  const casti = [];
  if (k.jmeno) casti.push(esc(k.jmeno));
  if (k.email) casti.push('<a href="mailto:' + esc(k.email) + '">' + esc(k.email) + "</a>");
  if (k.telefon) casti.push('<a href="tel:' + esc(k.telefon.replace(/\s/g, "")) + '">' + esc(k.telefon) + "</a>");
  if (k.telefon && k.whatsapp) casti.push('<a href="https://wa.me/' + esc(k.telefon.replace(/\D/g, "")) + '" target="_blank" rel="noopener">WhatsApp</a>');
  if (!casti.length) return "";
  return "Živý člověk: " + casti.join(", ") + "." + (k.kdy ? " " + esc(k.kdy) : "");
}
function odkazyHtml() {
  const o = C.odkazy || {};
  const jeden = (adresa, text) => (adresa ? '<a href="' + esc(adresa) + '" target="_blank" rel="noopener">' + text + "</a>" : "<span>" + text + " (připravujeme)</span>");
  return jeden(o.podminky, "Podmínky pilotu") + '<span class="tecka"></span>' + jeden(o.zasady, "Zpracování údajů");
}

function cas(iso) {
  return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
