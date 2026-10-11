/* Přehled pilotu pro správce: kolik lidí se ptalo, kdo se vrátil, na co a kde karty nestačily. */
"use strict";
(() => {
  let zpravy = [];
  let filtr = "vse";

  const SHODA = { sedi: "karta sedí", zcasti: "jen zčásti", nic: "bez karty" };

  function cislo(hodnota, popis) {
    const d = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = hodnota;
    const s = document.createElement("span");
    s.textContent = popis;
    d.append(b, s);
    return d;
  }

  function vykresliCisla(s, karet) {
    const usd = (n) => n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
    $("cisla").replaceChildren(
      cislo(s.lidi, "lidí se ptalo"),
      cislo(s.vratilo_se, "z nich se vrátilo jiný den do 14 dnů"),
      cislo(s.zprav, "dotazů v " + s.rozhovoru + " rozhovorech"),
      cislo(s.bez_karty, "dotazů, na které žádná karta neseděla"),
      cislo(s.jen_zcasti, "dotazů, kde karta seděla jen zčásti"),
      cislo(usd(s.cena_na_rozhovor_usd), "průměrná cena jednoho rozhovoru"),
      cislo(usd(s.cena_usd), "cena celkem (" + karet + " karet v provozu)"),
    );
  }

  function vykresliDotazy() {
    const vybrane = zpravy.filter((z) =>
      filtr === "vse" ? true : filtr === "chyba" ? z.stav === "chyba" : z.stav !== "chyba" && (filtr === "bez" ? z.shoda === "nic" : z.shoda === "zcasti"),
    );
    $("prazdno").hidden = vybrane.length > 0;
    $("dotazy").replaceChildren(
      ...vybrane.map((z) => {
        const li = document.createElement("li");
        const kdo = document.createElement("div");
        kdo.className = "kdo";
        const znak = document.createElement("span");
        const druh = z.stav === "chyba" ? "chyba" : z.shoda || "nic";
        znak.className = "znak " + druh;
        znak.textContent = z.stav === "chyba" ? "chyba" : SHODA[druh];
        const karty = (z.karty || []).map((k) => k.id).join(", ");
        const kus = (text) => {
          const span = document.createElement("span");
          span.textContent = text;
          return span;
        };
        kdo.append(kus(cas(z.cas)), kus(z.email), znak);
        if (karty) kdo.append(kus(karty));
        const co = document.createElement("p");
        co.className = "co";
        co.textContent = z.dotaz;
        li.append(kdo, co);
        if (z.stav === "chyba" && z.chyba) {
          const proc = document.createElement("p");
          proc.className = "male tlumene";
          proc.textContent = "Důvod: " + z.chyba;
          li.append(proc);
        }
        if (z.odpoved) {
          const det = document.createElement("details");
          const sum = document.createElement("summary");
          sum.textContent = "Odpověď";
          const odp = document.createElement("div");
          odp.className = "odpoved";
          odp.innerHTML = md(z.odpoved);
          det.append(sum, odp);
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
        const bunka = (text, trida) => {
          const td = document.createElement("td");
          td.textContent = text;
          if (trida) td.className = trida;
          return td;
        };
        tr.append(bunka(l.email), bunka(cas(l.prvni)), bunka(cas(l.posledni)), bunka(l.zprav, "cislo"), bunka(l.rozhovoru, "cislo"), bunka(l.dnu, "cislo"), bunka(l.vratil_se ? "ano" : "zatím ne"));
        return tr;
      }),
    );
  }

  function vykresliPozvane(seznam) {
    $("pozvani").replaceChildren(
      ...seznam.map((p) => {
        const tr = document.createElement("tr");
        const bunka = (text) => {
          const td = document.createElement("td");
          td.textContent = text;
          return td;
        };
        const akce = document.createElement("td");
        if (!p.spravce) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tichy";
          b.textContent = p.aktivni ? "Odebrat" : "Vrátit";
          b.addEventListener("click", () => zmenPozvaneho({ email: p.email, jmeno: p.jmeno, aktivni: !p.aktivni }));
          akce.append(b);
        }
        tr.append(bunka(p.email), bunka(p.jmeno || ""), bunka(p.spravce ? "správce" : p.aktivni ? "pozvaný" : "odebraný"), akce);
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
      const [prehled, pozvani] = await Promise.all([server("prehled"), server("pozvani")]);
      const data = await prehled.json();
      zpravy = data.zpravy;
      $("obdobi").textContent = "Posledních 90 dnů, bez zkušebních dotazů. Stav k " + cas(new Date().toISOString()) + ".";
      vykresliCisla(data.souhrn, data.karet);
      vykresliDotazy();
      vykresliLidi(data.souhrn.lide);
      vykresliPozvane((await pozvani.json()).pozvani);
      $("stavPrehledu").hidden = true;
      $("obsah").hidden = false;
    } catch (e) {
      $("stavPrehledu").textContent =
        e.kod === "neprihlasen" ? "Nejdřív se přihlaste v rozhovoru, pak se sem vraťte." : e.kod === "nespravce" ? "Tahle stránka je jen pro správce pilotu." : e.message;
    }
  })();
})();
