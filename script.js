(function () {
  var CACHE_KEY = "site-data-v2";
  var activeCategory = "";
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Загрузка данных ----------

  function sheetUrl(name) {
    return "https://docs.google.com/spreadsheets/d/" + GOOGLE_SHEET_ID +
      "/gviz/tq?tqx=out:csv&headers=1&sheet=" + encodeURIComponent(name); // headers=1: заголовок ровно одна строка
  }

  // Разбор CSV с учётом кавычек и переносов строк внутри ячеек
  function parseCsv(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function fetchSheet(name) {
    return fetch(sheetUrl(name)).then(function (r) {
      if (!r.ok) throw new Error(name);
      return r.text();
    }).then(function (t) {
      return parseCsv(t).slice(1); // первая строка — заголовки
    });
  }

  function loadFromSheet() {
    return Promise.all([
      fetchSheet("Услуги"), fetchSheet("О себе"), fetchSheet("Контакты и график"),
      fetchSheet("Вопросы").catch(function () { return null; }) // лист необязательный
    ]).then(function (res) {
      var data = { services: res[0], about: res[1], contacts: res[2], faq: res[3] || FALLBACK.faq };
      // Если таблицу случайно испортили — не показываем пустой сайт
      var ok = data.services.filter(function (r) { return r[1] && r[1].trim(); }).length > 0;
      if (!ok) throw new Error("empty");
      return data;
    });
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // ---------- Вывод на страницу ----------

  function toMap(rows) {
    var m = {};
    (rows || []).forEach(function (r) { if (r[0]) m[r[0].trim()] = (r[1] || "").trim(); });
    return m;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Короткие слова не остаются в конце строки
  function typo(s) {
    var re = /(^|[\s(«])(в|во|и|а|но|на|по|за|из|от|до|не|к|ко|с|со|у|о|об|для|пр\.|г\.)\s+/gi;
    var keep = function (m, a, b) { return a + b + " "; };
    return s.replace(re, keep).replace(re, keep).replace(/,\s+(\d)/g, ", $1");
  }

  // Склонение: 1 услуга, 2 услуги, 5 услуг
  function plural(n, one, few, many) {
    var a = n % 100, b = n % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    return b > 1 && b < 5 ? few : many;
  }

  function fillTexts(info) {
    document.querySelectorAll("[data-text]").forEach(function (el) {
      var val = info[el.getAttribute("data-text")];
      if (val === undefined) return;
      if (!val) {
        el.innerHTML = '<span class="empty">будет добавлено</span>';
      } else if (el.hasAttribute("data-multiline")) {
        el.innerHTML = val.split("\n").filter(Boolean).map(function (p) {
          return el.tagName === "DIV" ? "<p>" + esc(typo(p)) + "</p>" : esc(typo(p));
        }).join(el.tagName === "DIV" ? "" : "<br>");
      } else if (el.hasAttribute("data-accent")) {
        // Два последних слова заголовка — курсивом
        var words = val.split(/\s+/);
        var tail = words.splice(Math.max(words.length - 2, 0));
        el.innerHTML = esc(typo(words.join(" "))) + " <em>" + esc(typo(tail.join(" "))) + "</em>";
      } else {
        el.textContent = typo(val);
      }
    });
  }

  function fillLinks(info) {
    var phone = (info["Телефон"] || "").replace(/[^\d+]/g, "");
    var tg = (info["Telegram"] || "").replace(/^@/, "");
    var addr = info["Адрес"];
    var geo = (info["Координаты"] || "").split(",").map(parseFloat);
    var hasGeo = geo.length === 2 && !isNaN(geo[0]) && !isNaN(geo[1]);
    var links = {
      phone: phone && "tel:" + phone,
      vk: info["ВКонтакте"],
      telegram: tg && (tg.indexOf("http") === 0 ? tg : "https://t.me/" + tg),
      map: hasGeo ? "https://yandex.ru/maps/?pt=" + geo[1] + "," + geo[0] + "&z=18&l=map" :
        addr && "https://yandex.ru/maps/?text=" + encodeURIComponent(addr),
      route: hasGeo && "https://yandex.ru/maps/?rtext=~" + geo[0] + "," + geo[1] + "&rtt=auto"
    };
    document.querySelectorAll("[data-link]").forEach(function (el) {
      var href = links[el.getAttribute("data-link")];
      if (href) {
        el.href = href;
        el.style.display = "";
        if (href.indexOf("http") === 0) { el.target = "_blank"; el.rel = "noopener"; }
      } else {
        el.style.display = "none"; // нет ссылки — прячем кнопку
      }
    });

    // Карта-картинка без рекламы; не загрузилась — остаются ссылки под ней
    var view = document.getElementById("map-view");
    var img = document.getElementById("map-img");
    img.onerror = function () { view.style.display = "none"; };
    if (hasGeo) {
      var src = "https://static-maps.yandex.ru/1.x/?ll=" + geo[1] + "," + geo[0] + "&z=16&l=map&size=650,450&lang=ru_RU";
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    } else {
      view.style.display = "none";
    }
  }

  // В таблице цену можно написать просто числом: 2800 → «2 800 ₽»
  function money(s) {
    s = (s || "").trim();
    if (!/^\d[\d\s]*$/.test(s)) return s;
    return s.replace(/\s/g, "").replace(/\B(?=(\d{3})+$)/g, " ") + " ₽";
  }

  function visibleServices(services) {
    return services.filter(function (r) {
      return r[1] && r[1].trim() && (r[4] || "").trim().toLowerCase() !== "нет";
    });
  }

  function renderPrice(services) {
    var visible = visibleServices(services);
    var groups = [];
    var byCat = {};
    visible.forEach(function (r) {
      var cat = (r[0] || "Другое").trim();
      if (!byCat[cat]) { byCat[cat] = []; groups.push(cat); }
      byCat[cat].push(r);
    });

    var chips = document.getElementById("chips");
    if (groups.indexOf(activeCategory) < 0) activeCategory = groups[0];
    chips.innerHTML = groups.map(function (g) {
      return '<button class="chip' + (g === activeCategory ? " is-active" : "") + '">' + esc(g) + "</button>";
    }).join("");
    chips.querySelectorAll(".chip").forEach(function (b) {
      b.onclick = function () { activeCategory = b.textContent; renderPrice(services); };
    });

    document.getElementById("price").innerHTML = groups.filter(function (g) {
      return g === activeCategory;
    }).map(function (g) {
      var n = byCat[g].length;
      return '<div class="price__group"><div class="price__side">' +
        '<div class="price__sticky"><h3>' + esc(g) + '</h3><p class="price__count">' + n + " " + plural(n, "услуга", "услуги", "услуг") + "</p>" +
        '<a class="btn btn--white btn--small" href="#contacts">Записаться</a></div>' +
        '<svg class="sprig price__sprig" aria-hidden="true"><use href="#sprig-a"/></svg></div>' +
        '<div class="price__rows">' + byCat[g].map(function (r, i) {
          return '<div class="row" style="--i:' + Math.min(i, 12) + '"><div class="row__top">' +
            '<span class="row__name">' + esc(r[1]) + '</span><i class="row__dots"></i>' +
            '<span class="row__price">' + esc(money(r[3])) + "</span></div>" +
            (r[2] ? '<div class="row__desc">' + esc(r[2]) + "</div>" : "") + "</div>";
        }).join("") + "</div></div>";
    }).join("");

    renderMarquee(groups);

    // Число направлений и цена сертификата берутся из прайса
    var count = groups.filter(function (g) { return !/подар/i.test(g); }).length;
    document.querySelectorAll("[data-count]").forEach(function (el) {
      el.setAttribute("data-value", count);
      if (!el.hasAttribute("data-counting")) el.textContent = count;
    });
    document.querySelectorAll("[data-count-word]").forEach(function (el) { el.textContent = plural(count, "направление", "направления", "направлений"); });
    var gift = visible.filter(function (r) { return /сертификат/i.test(r[1]); })[0];
    var giftEl = document.getElementById("gift-price");
    if (gift && gift[3]) giftEl.textContent = money(gift[3]);
  }

  // Бегущая строка повторяет категории прайса: половина ленты — копия другой
  function renderMarquee(groups) {
    var items = groups.filter(function (g) { return !/подар/i.test(g); }).map(function (g) {
      return "<span>" + esc(g) + "</span>";
    }).join("");
    var half = items + items + items;
    document.getElementById("marquee").innerHTML = half + half;
  }

  function renderFaq(faq) {
    document.getElementById("faq-list").innerHTML = (faq || []).filter(function (r) {
      return r[0] && r[0].trim();
    }).map(function (r) {
      return "<details><summary>" + esc(r[0]) + "</summary>" + (r[1] || "").split("\n").map(function (p) {
        return "<p>" + esc(p) + "</p>";
      }).join("") + "</details>";
    }).join("");
  }

  function render(data) {
    var info = Object.assign(toMap(data.about), toMap(data.contacts));
    fillTexts(info);
    fillLinks(info);
    renderPrice(data.services || []);
    renderFaq(data.faq || FALLBACK.faq);
  }

  // ---------- Поведение страницы ----------

  // Меню на телефоне
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");
  burger.onclick = function () {
    var open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", open);
  };
  nav.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", function () {
      nav.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    });
  });

  // Прокрутка: тень у шапки, панель «Позвонить», полоска сверху, движение веточек
  var top = document.querySelector(".top");
  var callbar = document.querySelector(".callbar");
  var progress = document.getElementById("progress");
  var floaters = reduceMotion || window.innerWidth <= 860 ? [] :
    Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY;
    var vh = window.innerHeight;
    var max = document.documentElement.scrollHeight - vh;
    top.classList.toggle("is-scrolled", y > 10);
    callbar.classList.toggle("is-shown", y > 500);
    progress.style.transform = "scaleX(" + (max > 0 ? Math.min(y / max, 1) : 0) + ")";
    floaters.forEach(function (el) {
      var box = el.parentNode.getBoundingClientRect();
      if (box.bottom < -200 || box.top > vh + 200) return;
      var shift = (box.top + box.height / 2 - vh / 2) * parseFloat(el.getAttribute("data-parallax"));
      el.style.setProperty("--py", shift.toFixed(1) + "px");
    });
  }
  function requestScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }
  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll, { passive: true });
  onScroll();

  // Лепестки на первом экране
  var hero = document.getElementById("hero");
  if (!reduceMotion) {
    var petals = window.innerWidth <= 860 ? 6 : 12;
    for (var p = 0; p < petals; p++) {
      var petal = document.createElement("i");
      var time = 15 + Math.random() * 13;
      petal.className = "petal";
      petal.style.cssText = "left:" + (Math.random() * 100).toFixed(1) + "%;--s:" + (.55 + Math.random() * .6).toFixed(2) +
        ";animation-duration:" + time.toFixed(1) + "s;animation-delay:-" + (Math.random() * time).toFixed(1) + "s";
      hero.appendChild(petal);
    }
  }

  // Сначала видны 6 работ, остальные и видео открываются по кнопке
  document.getElementById("works-more").onclick = function () {
    var short = document.querySelector(".works").classList.toggle("is-short");
    this.textContent = short ? "Показать ещё" : "Свернуть";
    // После сворачивания возвращаемся к началу блока
    if (short) document.getElementById("works").scrollIntoView();
  };

  // Отзывы: так же, сначала 8 штук
  document.getElementById("reviews-more").onclick = function () {
    var short = document.querySelector(".reviews").classList.toggle("is-short");
    this.textContent = short ? "Показать ещё" : "Свернуть";
    if (short) document.getElementById("reviews").scrollIntoView();
  };

  // Просмотр фото работ на весь экран
  var viewer = document.getElementById("viewer");
  var viewerImg = document.getElementById("viewer-img");
  var viewerVideo = document.getElementById("viewer-video");
  document.querySelectorAll(".work").forEach(function (b) {
    b.onclick = function () {
      var clip = b.getAttribute("data-video");
      var img = b.querySelector("img");
      viewerImg.hidden = !!clip;
      viewerVideo.hidden = !clip;
      if (clip) {
        viewerVideo.src = clip;
        viewer.showModal();
        viewerVideo.play().catch(function () {});
      } else {
        viewerImg.src = img.src;
        viewerImg.alt = img.alt;
        viewer.showModal();
      }
    };
  });
  function stopClip() {
    viewerVideo.pause();
    viewerVideo.removeAttribute("src");
    viewerVideo.load();
  }
  viewer.onclick = function (e) {
    if (e.target === viewerVideo) return;
    stopClip();
    viewer.close();
  };
  viewer.addEventListener("close", stopClip); // закрытие клавишей Esc

  // Плавный счёт от нуля
  function countUp(el) {
    if (reduceMotion || el.hasAttribute("data-counted")) return;
    el.setAttribute("data-counted", "");
    el.setAttribute("data-counting", "");
    var start = performance.now();
    function step(now) {
      var k = Math.min((now - start) / 1100, 1);
      var value = +el.getAttribute("data-value") || 0;
      el.textContent = Math.round(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
      else el.removeAttribute("data-counting");
    }
    requestAnimationFrame(step);
  }

  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    // Плавное появление блоков при прокрутке: соседние блоки выходят по очереди
    items.forEach(function (el) {
      var kin = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.classList.contains("reveal"); });
      var i = kin.indexOf(el);
      if (i > 0) el.style.setProperty("--d", i * .11 + "s");
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
        e.target.querySelectorAll("[data-count]").forEach(countUp);
        // После появления блок снова реагирует на наведение без задержек
        setTimeout(function () { e.target.classList.remove("reveal", "reveal--left", "reveal--right", "is-visible"); }, 1500);
      });
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });

    // Подсветка раздела в меню
    var links = {};
    nav.querySelectorAll("a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (id) { links[id].classList.toggle("is-current", id === e.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(links).concat("hero").forEach(function (id) { spy.observe(document.getElementById(id)); });

    // Когда первый экран не виден, его анимации стоят и не тратят батарею
    new IntersectionObserver(function (entries) {
      hero.classList.toggle("is-away", !entries[0].isIntersecting);
    }).observe(hero);
  } else {
    items.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // Сначала сразу показываем то, что есть, потом обновляем из таблицы
  render(readCache() || FALLBACK);
  if (GOOGLE_SHEET_ID) {
    loadFromSheet().then(function (data) {
      writeCache(data);
      render(data);
    }).catch(function () { /* оставляем последние сохранённые данные */ });
  }
})();
