/* Přehled pilotu pro správce: kolik lidí se ptalo, kdo se vrátil, na co, kde karty nestačily a poznámky pro kartotéku. */
"use strict";
(() => {
  let zpravy = [];
  let podnety = [];
  let souhrn = null;
  let karet = 0;
  let filtr = "vse";

  const SHODA = { sedi: "karta sedí", zcasti: "jen zčásti", nic: "bez karty" };
  const STAV_PODNETU = { otevreny: "čeká na zapracování", vyrizeny: "zapracováno", zamitnuty: "do karet nepůjde" };

  function prvek(znacka, trida, text) {
    const el = document.createElement(znacka);
    if (trida) el.className = trida;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function cislo(hodnota, popis) {
    const d = document.createElement("div");
    d.append(prvek("b", "", hodnota), prvek("span", "", popis));
    return d;
  }

  function vykresliCisla() {
    const s = souhrn;
    const usd = (n) => n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
    const ceka = podnety.filter((pd) => pd.stav === "otevreny").length;
    const popisPoznamek = ceka === 1 ? "poznámka čeká na zapracování do karet" : ceka >= 2 && ceka <= 4 ? "poznámky čekají na zapracování do karet" : "poznámek čeká na zapracování do karet";
    $("cisla").replaceChildren(
      cislo(s.lidi, "lidí se ptalo"),
      cislo(s.vratilo_se, "z nich se vrátilo jiný den do 14 dnů"),
      cislo(s.zprav, "dotazů v " + s.rozhovoru + " rozhovorech"),
      cislo(s.bez_karty, "dotazů, na které žádná karta neseděla"),
      cislo(s.jen_zcasti, "dotazů, kde karta seděla jen zčásti"),
      cislo(ceka, popisPoznamek),
      cislo(usd(s.cena_na_rozhovor_usd), "průměrná cena jednoho rozhovoru"),
      cislo(usd(s.cena_usd), "cena celkem (" + karet + " karet v provozu)"),
    );
  }

  /* ---------- Poznámky pro kartotéku ---------- */
  function podnetPrvek(pd, znacka, sDotazem) {
    const obal = prvek(znacka, "podnet");
    const hlava = prvek("div", "kdo");
    hlava.append(prvek("span", "", cas(pd.cas)), prvek("span", "", pd.jmeno || pd.autor), prvek("span", "znak " + pd.stav, STAV_PODNETU[pd.stav] || pd.stav));
    obal.append(hlava, prvek("p", "podnet-text", pd.text));
    if (sDotazem && pd.druh === "k_odpovedi") {
      obal.append(prvek("p", "podnet-k", pd.dotaz ? "K odpovědi na dotaz: „" + pd.dotaz + "“" : "K odpovědi, která už v přehledu není."));
    }
    if (pd.poznamka) obal.append(prvek("p", "podnet-k", "Co se s tím stalo: " + pd.poznamka));
    return obal;
  }

  function vykresliPodnety() {
    $("podnety").replaceChildren(...podnety.map((pd) => podnetPrvek(pd, "li", true)));
    $("zadnePodnety").hidden = podnety.length > 0;
  }

  async function ulozPodnet(telo) {
    const data = await (await server("podnety", { metoda: "POST", telo })).json();
    podnety = data.podnety;
    vykresliPodnety();
    vykresliCisla();
  }

  /** Pod odpovědí: dosavadní poznámky k ní a tlačítko „Řekla bych to jinak“. */
  function uOdpovedi(z) {
    const obal = prvek("div", "u-odpovedi");
    const dosavadni = () => podnety.filter((pd) => pd.zprava === z.id).reverse().map((pd) => podnetPrvek(pd, "div", false));
    const tlacitko = prvek("button", "tichy", "Řekla bych to jinak");
    tlacitko.type = "button";
    const zavri = () => obal.replaceChildren(...dosavadni(), tlacitko);

    tlacitko.addEventListener("click", () => {
      const form = prvek("form", "podnet-form");
      form.noValidate = true;
      const label = prvek("label", "", "Jak byste to řekla vy");
      label.htmlFor = "podnet-" + z.id;
      const pole = document.createElement("textarea");
      pole.id = "podnet-" + z.id;
      pole.rows = 4;
      pole.maxLength = 4000;
      const ulozit = prvek("button", "hlavni", "Uložit poznámku");
      ulozit.type = "submit";
      const zrusit = prvek("button", "tichy", "Zrušit");
      zrusit.type = "button";
      const h = prvek("p", "hlaska");
      h.setAttribute("role", "status");
      const radek = prvek("div", "radek");
      radek.append(ulozit, zrusit, h);
      form.append(label, pole, radek);
      zrusit.addEventListener("click", zavri);
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = pole.value.trim();
        if (!text) {
          h.className = "hlaska chyba";
          h.textContent = "Napište prosím, co byste řekla jinak.";
          return;
        }
        ulozit.disabled = true;
        h.className = "hlaska";
        h.textContent = "Ukládám…";
        try {
          await ulozPodnet({ druh: "k_odpovedi", zprava: z.id, text });
          zavri();
        } catch (e) {
          // Rozepsaný text zůstává v poli, ať se po výpadku spojení neztratí.
          h.className = "hlaska chyba";
          h.textContent = e.message;
          ulozit.disabled = false;
        }
      });
      obal.replaceChildren(...dosavadni(), form);
      pole.focus();
    });

    zavri();
    return obal;
  }

  $("formPodnet").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const h = $("hlaskaPodnet");
    const text = $("textPodnetu").value.trim();
    if (!text) {
      h.className = "hlaska chyba";
      h.textContent = "Napište prosím, co v kartách chybí.";
      return;
    }
    $("ulozitPodnet").disabled = true;
    h.className = "hlaska";
    h.textContent = "Ukládám…";
    try {
      await ulozPodnet({ druh: "volny", text });
      $("textPodnetu").value = "";
      h.className = "hlaska dobre";
      h.textContent = "Uloženo.";
    } catch (e) {
      h.className = "hlaska chyba";
      h.textContent = e.message;
    } finally {
      $("ulozitPodnet").disabled = false;
    }
  });

  /* ---------- Dotazy ---------- */
  function vykresliDotazy() {
    const sPoznamkou = new Map();
    for (const pd of podnety) if (pd.zprava !== null) sPoznamkou.set(pd.zprava, (sPoznamkou.get(pd.zprava) || 0) + 1);
    const vybrane = zpravy.filter((z) =>
      filtr === "vse" ? true
        : filtr === "poznamka" ? sPoznamkou.has(z.id)
        : filtr === "chyba" ? z.stav === "chyba"
        : z.stav !== "chyba" && (filtr === "bez" ? z.shoda === "nic" : z.shoda === "zcasti"),
    );
    $("prazdno").hidden = vybrane.length > 0;
    $("dotazy").replaceChildren(
      ...vybrane.map((z) => {
        const li = document.createElement("li");
        const kdo = prvek("div", "kdo");
        const druh = z.stav === "chyba" ? "chyba" : z.shoda || "nic";
        const znak = prvek("span", "znak " + druh, z.stav === "chyba" ? "chyba" : SHODA[druh]);
        const karty = (z.karty || []).map((k) => k.id).join(", ");
        kdo.append(prvek("span", "", cas(z.cas)), prvek("span", "", z.email), znak);
        if (karty) kdo.append(prvek("span", "", karty));
        const pocet = sPoznamkou.get(z.id);
        if (pocet) kdo.append(prvek("span", "znak otevreny", pocet === 1 ? "poznámka" : pocet + (pocet <= 4 ? " poznámky" : " poznámek")));
        li.append(kdo, prvek("p", "co", z.dotaz));
        if (z.stav === "chyba" && z.chyba) li.append(prvek("p", "male tlumene", "Důvod: " + z.chyba));
        if (z.odpoved) {
          const det = document.createElement("details");
          const odp = prvek("div", "odpoved");
          odp.innerHTML = md(z.odpoved);
          det.append(prvek("summary", "", "Odpověď"), odp, uOdpovedi(z));
          li.append(det);
        }
        return li;
      }),
    );
  }

  function vykresliLidi(lide) {
    $("lide").replaceChildren(
      ...lide.map((l) => {
        const tr = document.createElement("tr");
        tr.append(
          prvek("td", "", l.email), prvek("td", "", cas(l.prvni)), prvek("td", "", cas(l.posledni)), prvek("td", "cislo", l.zprav),
          prvek("td", "cislo", l.rozhovoru), prvek("td", "cislo", l.dnu), prvek("td", "", l.vratil_se ? "ano" : "zatím ne"),
        );
        return tr;
      }),
    );
  }

  function vykresliPozvane(seznam) {
    $("pozvani").replaceChildren(
      ...seznam.map((p) => {
        const tr = document.createElement("tr");
        const akce = document.createElement("td");
        if (!p.spravce) {
          const b = prvek("button", "tichy", p.aktivni ? "Odebrat" : "Vrátit");
          b.type = "button";
          b.addEventListener("click", () => zmenPozvaneho({ email: p.email, jmeno: p.jmeno, aktivni: !p.aktivni }));
          akce.append(b);
        }
        tr.append(
          prvek("td", "", p.email), prvek("td", "", p.jmeno || ""),
          prvek("td", "", p.spravce ? "správce" : !p.aktivni ? "odebraný" : p.zdroj === "registrace" ? "zaregistroval se sám" : "pozvaný"),
          akce,
        );
        return tr;
      }),
    );
  }

  async function zmenPozvaneho(telo) {
    const h = $("hlaskaPozvani");
    try {
      const data = await (await server("pozvani", { metoda: "POST", telo })).json();
      vykresliPozvane(data.pozvani);
      h.className = "hlaska dobre";
      h.textContent = telo.aktivni === false ? "Odebráno." : "Uloženo. Pozvaný se přihlásí svým e-mailem na adrese stránky.";
    } catch (e) {
      h.className = "hlaska chyba";
      h.textContent = e.message;
    }
  }

  $("formPozvat").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("novyEmail").value.trim().toLowerCase();
    if (!email) return;
    await zmenPozvaneho({ email, jmeno: $("noveJmeno").value.trim() });
    if ($("hlaskaPozvani").classList.contains("dobre")) {
      $("novyEmail").value = "";
      $("noveJmeno").value = "";
    }
  });

  $("filtry").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-filtr]");
    if (!b) return;
    filtr = b.dataset.filtr;
    for (const t of $("filtry").querySelectorAll("[data-filtr]")) t.setAttribute("aria-pressed", String(t === b));
    vykresliDotazy();
  });

  (async () => {
    try {
      const [prehled, pozvani, poznamky] = await Promise.all([server("prehled"), server("pozvani"), server("podnety")]);
      const data = await prehled.json();
      zpravy = data.zpravy;
      souhrn = data.souhrn;
      karet = data.karet;
      podnety = (await poznamky.json()).podnety;
      $("obdobi").textContent = "Posledních 90 dnů, bez zkušebních dotazů. Stav k " + cas(new Date().toISOString()) + ".";
      vykresliCisla();
      vykresliPodnety();
      vykresliDotazy();
      vykresliLidi(souhrn.lide);
      vykresliPozvane((await pozvani.json()).pozvani);
      $("stavPrehledu").hidden = true;
      $("obsah").hidden = false;
    } catch (e) {
      $("stavPrehledu").textContent =
        e.kod === "neprihlasen" ? "Nejdřív se přihlaste v rozhovoru, pak se sem vraťte." : e.kod === "nespravce" ? "Tahle stránka je jen pro správce pilotu." : e.message;
    }
  })();
})();
