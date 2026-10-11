/* Rozhovor: přihlášení, vlákno, odesílání a průběžné psaní odpovědi. */
"use strict";
(() => {
  const KLIC_ROZHOVORU = "sarka.rozhovor";
  const KLIC_CEKANI = "sarka.ceka";
  const stav = { email: "", zbyva: null, spravce: false, rozhovor: null, tahy: [], bezi: false };

  /* ---------- Pohledy ---------- */
  function ukaz(pohled) {
    for (const id of ["nacitani", "vstup", "rozhovor"]) $(id).hidden = id !== pohled;
    const vRozhovoru = pohled === "rozhovor";
    $("psani").hidden = !vRozhovoru;
    $("upozorneni").hidden = !vRozhovoru;
    $("novy").hidden = !vRozhovoru;
  }
  function hlaska(id, text, druh) {
    const el = $(id);
    el.textContent = text || "";
    el.className = "hlaska" + (druh ? " " + druh : "");
  }
  function ukazFormular(ktery) {
    for (const id of ["formEmail", "formKod", "formOdkaz"]) $(id).hidden = id !== ktery;
  }

  /* ---------- Přihlášení ---------- */
  async function posliEmail(email, kamHlasit) {
    await server("prihlaseni", { metoda: "POST", telo: { email }, verejne: true });
    Sklad.uloz(KLIC_CEKANI, { email, kdy: Date.now() });
    $("komu").textContent = email;
    ukazFormular("formKod");
    hlaska("hlaskaKod", kamHlasit === "znovu" ? "Poslali jsme nový e-mail." : "", "dobre");
    $("kod").value = "";
    $("kod").focus();
  }

  $("formEmail").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return hlaska("hlaskaEmail", "Zkontrolujte prosím e-mailovou adresu.", "chyba");
    $("poslatEmail").disabled = true;
    hlaska("hlaskaEmail", "Posílám…");
    try {
      await posliEmail(email);
      hlaska("hlaskaEmail", "");
    } catch (e) {
      hlaska("hlaskaEmail", e.message, "chyba");
    } finally {
      $("poslatEmail").disabled = false;
    }
  });

  $("znovu").addEventListener("click", async () => {
    const ceka = Sklad.cti(KLIC_CEKANI);
    if (!ceka) return ukazFormular("formEmail");
    $("znovu").disabled = true;
    try {
      await posliEmail(ceka.email, "znovu");
    } catch (e) {
      hlaska("hlaskaKod", e.message, "chyba");
    } finally {
      setTimeout(() => { $("znovu").disabled = false; }, 60000);
    }
  });

  $("jinaAdresa").addEventListener("click", () => {
    Sklad.uloz(KLIC_CEKANI, null);
    ukazFormular("formEmail");
    $("email").focus();
  });

  $("kod").addEventListener("input", () => {
    $("kod").value = $("kod").value.replace(/\D/g, "");
  });

  $("formKod").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ceka = Sklad.cti(KLIC_CEKANI);
    const kod = $("kod").value.trim();
    if (!ceka) return ukazFormular("formEmail");
    if (kod.length < 6) return hlaska("hlaskaKod", "Kód má šest číslic. Opište ho prosím celý.", "chyba");
    $("overitKod").disabled = true;
    hlaska("hlaskaKod", "Ověřuji…");
    try {
      await Ucet.overKod(ceka.email, kod);
      Sklad.uloz(KLIC_CEKANI, null);
      await poPrihlaseni();
    } catch (e) {
      hlaska("hlaskaKod", e.status === 429 ? "Moc pokusů za sebou. Chvíli počkejte." : e.status ? "Kód nesedí nebo už vypršel. Opište ho znovu, nebo si nechte poslat nový." : "Nepovedlo se spojit. Zkuste to znovu.", "chyba");
    } finally {
      $("overitKod").disabled = false;
    }
  });

  $("formOdkaz").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const otisk = new URL(location.href).searchParams.get("token_hash");
    $("dokoncit").disabled = true;
    hlaska("hlaskaOdkaz", "Přihlašuji…");
    try {
      await Ucet.overOdkaz(otisk);
      Sklad.uloz(KLIC_CEKANI, null);
      history.replaceState(null, "", location.pathname);
      await poPrihlaseni();
    } catch (e) {
      history.replaceState(null, "", location.pathname);
      ukazFormular(Sklad.cti(KLIC_CEKANI) ? "formKod" : "formEmail");
      const text = e.status ? "Odkaz už neplatí. Opište kód z e-mailu, nebo si nechte poslat nový." : "Nepovedlo se spojit. Zkuste to znovu.";
      hlaska(Sklad.cti(KLIC_CEKANI) ? "hlaskaKod" : "hlaskaEmail", text, "chyba");
    } finally {
      $("dokoncit").disabled = false;
    }
  });

  async function odhlas(duvod) {
    await Ucet.odhlas();
    Sklad.uloz(KLIC_ROZHOVORU, null);
    stav.rozhovor = null;
    stav.tahy = [];
    $("vlakno").replaceChildren();
    ukazFormular("formEmail");
    hlaska("hlaskaEmail", duvod || "", duvod ? "chyba" : "");
    ukaz("vstup");
  }

  async function poPrihlaseni() {
    try {
      const ja = await (await server("ja")).json();
      stav.email = ja.email;
      stav.zbyva = ja.zbyva;
      stav.spravce = ja.spravce;
    } catch (e) {
      if (["neprihlasen", "nepozvan", "priprava"].includes(e.kod)) return odhlas(e.message);
      stav.email = (Ucet.relace && Ucet.relace.email) || "";
    }
    nactiRozhovor();
    vykresliPatu();
    ukaz("rozhovor");
  }

  /* ---------- Vlákno ---------- */
  function uPaty() {
    return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  }
  function dolu() {
    window.scrollTo({ top: document.body.scrollHeight });
  }

  function zdroje(tah) {
    if (!tah.karty || !tah.karty.length || (tah.shoda !== "sedi" && tah.shoda !== "zcasti")) return null;
    const d = document.createElement("div");
    d.className = "zdroje";
    d.append(tah.shoda === "sedi" ? "Z karet:" : "Nejbližší karta, sedí jen zčásti:");
    for (const k of tah.karty) {
      const s = document.createElement("span");
      s.className = "stitek";
      const b = document.createElement("b");
      b.textContent = k.id;
      s.append(b, " · " + k.nazev);
      d.append(s);
    }
    return d;
  }

  function vykresliOdpoved(el, tah, faze) {
    if (tah.odpoved) {
      el.innerHTML = md(tah.odpoved);
    } else {
      el.innerHTML = '<span class="pise"><i><span></span></i>' + esc(faze || "Píšu odpověď") + "</span>";
    }
    if (tah.stav !== "bezi") {
      const z = zdroje(tah);
      if (z) el.append(z);
    }
  }

  function pridejTah(tah) {
    const ja = document.createElement("div");
    ja.className = "zprava ja";
    ja.textContent = tah.dotaz;
    const ona = document.createElement("div");
    ona.className = "zprava ona";
    vykresliOdpoved(ona, tah);
    $("vlakno").append(ja, ona);
    return { ja, ona };
  }

  function poznamka(text, tlacitko, akce) {
    const p = document.createElement("div");
    p.className = "poznamka";
    p.setAttribute("role", "alert");
    p.textContent = text;
    if (tlacitko) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = tlacitko;
      b.addEventListener("click", () => { p.remove(); akce(); });
      p.append(document.createElement("br"), b);
    }
    $("vlakno").append(p);
    dolu();
    return p;
  }
  function smazPoznamky() {
    document.querySelectorAll("#vlakno .poznamka").forEach((p) => p.remove());
  }

  function ulozRozhovor() {
    Sklad.uloz(KLIC_ROZHOVORU, stav.tahy.length ? { email: stav.email, rozhovor: stav.rozhovor, tahy: stav.tahy } : null);
  }

  function nactiRozhovor() {
    const ulozeny = Sklad.cti(KLIC_ROZHOVORU);
    $("vlakno").replaceChildren();
    stav.rozhovor = null;
    stav.tahy = [];
    if (ulozeny && ulozeny.email === stav.email && Array.isArray(ulozeny.tahy) && ulozeny.tahy.length) {
      stav.rozhovor = ulozeny.rozhovor;
      stav.tahy = ulozeny.tahy;
      let posledni = null;
      for (const tah of stav.tahy) posledni = pridejTah(tah);
      const nedopsany = stav.tahy[stav.tahy.length - 1];
      if (nedopsany.stav === "bezi") docti(nedopsany, posledni);
    }
    $("uvitani").hidden = stav.tahy.length > 0;
    nastavPsani();
  }

  function novyRozhovor() {
    if (stav.bezi) return;
    stav.rozhovor = null;
    stav.tahy = [];
    ulozRozhovor();
    $("vlakno").replaceChildren();
    $("uvitani").hidden = false;
    nastavPsani();
    window.scrollTo({ top: 0 });
    $("dotaz").focus();
  }

  /* ---------- Odeslání a čtení odpovědi ---------- */
  async function ctiProud(odpoved, naUdalost) {
    const ctecka = odpoved.body.getReader();
    const dekoder = new TextDecoder();
    let zbytek = "";
    for (;;) {
      const { done, value } = await ctecka.read();
      if (done) break;
      zbytek += dekoder.decode(value, { stream: true });
      let konec;
      while ((konec = zbytek.indexOf("\n\n")) >= 0) {
        const blok = zbytek.slice(0, konec);
        zbytek = zbytek.slice(konec + 2);
        const udalost = (/^event: (.+)$/m.exec(blok) || [])[1];
        const data = (/^data: (.+)$/m.exec(blok) || [])[1];
        if (udalost && data) naUdalost(udalost, JSON.parse(data));
      }
    }
  }

  function zahodTah(tah, prvky, text) {
    stav.tahy = stav.tahy.filter((t) => t !== tah);
    prvky.ja.remove();
    prvky.ona.remove();
    if (!$("dotaz").value) $("dotaz").value = text;
    $("uvitani").hidden = stav.tahy.length > 0;
    ulozRozhovor();
    vyska();
  }

  /** Spojení spadlo uprostřed odpovědi. Server ji dopíše sám, stránka si ji tady vyzvedne. */
  async function docti(tah, prvky) {
    stav.bezi = true;
    nastavPsani();
    vykresliOdpoved(prvky.ona, { ...tah, odpoved: "" }, "Spojení se přerušilo, dočítám odpověď");
    let vysledek = null;
    for (let pokus = 0; pokus < 45 && !vysledek; pokus++) {
      await new Promise((r) => setTimeout(r, pokus ? 3000 : 800));
      try {
        const data = await (await server("rozhovor?id=" + encodeURIComponent(stav.rozhovor))).json();
        const nalezeny = [...data.tahy].reverse().find((t) => t.dotaz === tah.dotaz);
        if (nalezeny && nalezeny.stav !== "bezi") vysledek = nalezeny;
        if (!nalezeny) break;
      } catch (e) {
        if (["neprihlasen", "nepozvan", "priprava"].includes(e.kod)) { stav.bezi = false; return odhlas(e.message); }
        if (e.kod === "rozhovor") break;
      }
    }
    stav.bezi = false;
    if (vysledek && vysledek.stav !== "chyba" && vysledek.odpoved) {
      Object.assign(tah, { odpoved: vysledek.odpoved, karty: vysledek.karty, shoda: vysledek.shoda, stav: "ok" });
      vykresliOdpoved(prvky.ona, tah);
      ulozRozhovor();
    } else {
      zahodTah(tah, prvky, tah.dotaz);
      poznamka("Odpověď se nepovedlo dokončit. Zkuste to prosím odeslat znovu.");
    }
    nastavPsani();
  }

  async function posli(text) {
    if (stav.bezi) return;
    stav.bezi = true;
    smazPoznamky();
    const tah = { dotaz: text, odpoved: "", karty: [], shoda: null, stav: "bezi" };
    stav.tahy.push(tah);
    $("uvitani").hidden = true;
    const prvky = pridejTah(tah);
    vykresliOdpoved(prvky.ona, tah, "Hledám v kartách");
    nastavPsani();
    dolu();

    let dokonceno = false;
    let predano = false;
    let kresleni = 0;
    try {
      const odpoved = await server("chat", { metoda: "POST", telo: { zprava: text, rozhovor: stav.rozhovor } });
      await ctiProud(odpoved, (udalost, data) => {
        if (udalost === "stav") {
          if (data.rozhovor) { stav.rozhovor = data.rozhovor; ulozRozhovor(); }
          if (data.faze === "pisu" && !tah.odpoved) vykresliOdpoved(prvky.ona, tah, "Píšu odpověď");
        } else if (udalost === "karty") {
          stav.rozhovor = data.rozhovor;
          tah.karty = data.karty;
          tah.shoda = data.shoda;
        } else if (udalost === "text" || udalost === "znovu") {
          tah.odpoved = udalost === "znovu" ? "" : tah.odpoved + data.t;
          cancelAnimationFrame(kresleni);
          kresleni = requestAnimationFrame(() => {
            const drzet = uPaty();
            vykresliOdpoved(prvky.ona, tah);
            if (drzet) dolu();
          });
        } else if (udalost === "konec") {
          dokonceno = true;
          if (typeof data.zbyva === "number") stav.zbyva = data.zbyva;
        } else if (udalost === "chyba") {
          throw new ChybaServeru(data.kod || "server", data.zprava, 500);
        }
      });
      cancelAnimationFrame(kresleni);
      if (!dokonceno) throw new ChybaServeru("preruseno", "", 0);
      tah.stav = "ok";
      const drzet = uPaty();
      vykresliOdpoved(prvky.ona, tah);
      if (drzet) dolu();
      ulozRozhovor();
    } catch (e) {
      cancelAnimationFrame(kresleni);
      const serverRekl = e instanceof ChybaServeru && e.kod !== "preruseno" && e.kod !== "spojeni";
      if (!serverRekl && stav.rozhovor) {
        // Výpadek spojení po odeslání: odpověď vzniká dál na serveru.
        ulozRozhovor();
        predano = true;
        return docti(tah, prvky);
      }
      zahodTah(tah, prvky, text);
      if (["neprihlasen", "nepozvan", "priprava"].includes(e.kod)) return odhlas(e.message);
      if (e.kod === "dlouhy" || e.kod === "rozhovor") poznamka(e.message, "Nový rozhovor", novyRozhovor);
      else poznamka(e.message || "Nepovedlo se spojit. Zkontrolujte připojení a zkuste to znovu.");
    } finally {
      if (!predano) {
        stav.bezi = false;
        nastavPsani();
        vykresliPatu();
      }
    }
  }

  /* ---------- Psaní ---------- */
  function vyska() {
    const t = $("dotaz");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight + 2, window.innerHeight * 0.4) + "px";
  }
  function nastavPsani() {
    $("odeslat").disabled = stav.bezi;
    $("odeslat").textContent = stav.tahy.length ? "Odeslat" : "Zeptat se";
    $("dotaz").placeholder = stav.tahy.length ? "Napište odpověď" : "Popište situaci";
    $("novy").disabled = stav.bezi;
  }

  $("dotaz").maxLength = C.znaku || 2000;
  $("dotaz").addEventListener("input", vyska);
  $("dotaz").addEventListener("keydown", (ev) => {
    // Na počítači Enter odesílá, na telefonu dělá nový řádek a odesílá se tlačítkem.
    const dotyk = window.matchMedia("(pointer: coarse)").matches;
    if (ev.key === "Enter" && !ev.isComposing && (ev.metaKey || ev.ctrlKey || (!ev.shiftKey && !dotyk))) {
      ev.preventDefault();
      $("formDotaz").requestSubmit();
    }
  });
  $("formDotaz").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = $("dotaz").value.trim();
    if (!text || stav.bezi) return;
    $("dotaz").value = "";
    vyska();
    posli(text);
  });
  $("novy").addEventListener("click", novyRozhovor);

  for (const priklad of C.priklady || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = priklad;
    b.addEventListener("click", () => {
      $("dotaz").value = priklad;
      vyska();
      $("dotaz").focus();
    });
    $("priklady").append(b);
  }

  /* ---------- Pata ---------- */
  function vykresliPatu() {
    $("pataKontakt").innerHTML = kontaktHtml();
    const p = $("pataOdkazy");
    p.innerHTML = odkazyHtml();
    const pridej = (prvek) => {
      const t = document.createElement("span");
      t.className = "tecka";
      p.append(t, prvek);
    };
    if (typeof stav.zbyva === "number" && stav.zbyva <= 10) {
      const s = document.createElement("span");
      s.textContent = "Dnes zbývá " + stav.zbyva + " zpráv";
      pridej(s);
    }
    const plocha = document.createElement("button");
    plocha.type = "button";
    plocha.className = "tichy";
    plocha.textContent = "Přidat na plochu";
    plocha.addEventListener("click", () => $("plocha").showModal());
    if (!window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone) pridej(plocha);
    if (stav.spravce) {
      const a = document.createElement("a");
      a.href = "prehled.html";
      a.textContent = "Přehled";
      pridej(a);
    }
    const ven = document.createElement("button");
    ven.type = "button";
    ven.className = "tichy";
    ven.textContent = "Odhlásit";
    ven.title = stav.email;
    ven.addEventListener("click", () => { if (!stav.bezi) odhlas(); });
    pridej(ven);
  }
  $("plochaZavrit").addEventListener("click", () => $("plocha").close());

  /* ---------- Start ---------- */
  $("vstupKontakt").innerHTML = kontaktHtml();
  $("vstupOdkazy").innerHTML = odkazyHtml();

  (async () => {
    if (!C.api || !C.supabase) {
      $("nacitani").textContent = "Stránka ještě není připojená k serveru.";
      return;
    }
    const maOdkaz = new URL(location.href).searchParams.has("token_hash");
    if (Ucet.relace) {
      if (maOdkaz) history.replaceState(null, "", location.pathname);
      return poPrihlaseni();
    }
    const ceka = Sklad.cti(KLIC_CEKANI);
    if (maOdkaz) {
      ukazFormular("formOdkaz");
    } else if (ceka && Date.now() - ceka.kdy < 60 * 60 * 1000) {
      $("komu").textContent = ceka.email;
      ukazFormular("formKod");
    } else {
      ukazFormular("formEmail");
    }
    ukaz("vstup");
  })();
})();
