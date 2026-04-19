(function () {
  "use strict";

  const maxLen = 200;
  const apiUrl = "/api/wishes";
  const securityApiUrl = "/api/security-settings?public=true";
  const types = [
    { slug: "love", displayName: "Love" },
    { slug: "wish", displayName: "心愿" },
    { slug: "feedback", displayName: "反馈" }
  ];
  const cardColors = {
    green: "rgb(217,242,217)",
    yellow: "rgb(249,247,217)",
    purple: "rgb(229,215,255)",
    pink: "rgb(255,224,227)",
    blue: "rgb(199,240,255)",
    orange: "rgb(255,216,168)"
  };

  let wishes = [];
  let currentFilter = "all";
  let selectedColor = "green";
  let currentTypeIndex = 0;
  let zCounter = 200;
  let captchaWidgetId = null;
  let captchaScriptLoading = null;
  let captchaSubmitting = false;
  let securitySettings = {
    captchaEnabled: false,
    captchaSiteKey: "",
    captchaHelp: "",
    dailyLimitEnabled: false,
    dailyLimitCount: 5
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    initTabs();
    initColorPicker();
    initTypeToggle();
    initCharCounter();
    initImageInput();
    initKeyboardLayout();
    initSubmit();
    await loadSecuritySettings();
    await loadApprovedWishes();
  }

  async function loadSecuritySettings() {
    try {
      const response = await fetch(securityApiUrl, { headers: { Accept: "application/json" } });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "读取安全设置失败");
      }

      securitySettings = {
        ...securitySettings,
        ...(data.settings || {})
      };
      renderSecurityControls();
    } catch (error) {
      console.error(error);
      renderSecurityControls();
    }
  }

  function renderSecurityControls() {
    const limitHint = document.getElementById("captchaLimitHint");
    limitHint.textContent = securitySettings.dailyLimitEnabled
      ? `每个 IP 每日最多留言 ${securitySettings.dailyLimitCount} 次。`
      : "";
    limitHint.hidden = !securitySettings.dailyLimitEnabled;
  }

  async function loadApprovedWishes() {
    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "读取失败");
      }

      wishes = data.wishes || [];
      renderCards();
    } catch (error) {
      console.error(error);
      wishes = seedWishes();
      renderCards();
      toast("数据库暂不可用，当前显示演示数据");
    }
  }

  function renderCards() {
    const board = document.getElementById("wishBoard");
    const empty = document.getElementById("wishEmpty");
    const template = document.getElementById("wishCardTemplate");
    const fragment = document.createDocumentFragment();
    const cardsWithImages = [];
    board.querySelectorAll(".wish-card").forEach((card) => card.remove());

    wishes.forEach((wish, index) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.id = wish.id;
      card.dataset.type = wish.type;
      card.dataset.color = wish.color || "green";
      card.style.background = cardColors[wish.color] || cardColors.green;

      card.querySelector(".wish-card-label").textContent = typeLabel(wish.type);
      card.querySelector(".wish-card-content").textContent = wish.content;
      card.querySelector(".wish-status-text").textContent = statusText(wish.status);
      card.querySelector(".wish-card-done-note").textContent = wish.doneNote || "";
      card.querySelector(".wish-card-ai").textContent = wish.aiReply || "";
      card.querySelector(".wish-card-nick").textContent = wish.nickname || "匿名";
      card.querySelector(".wish-card-date").textContent = formatDate(wish.createdAt);

      const image = card.querySelector(".wish-card-done-img");
      const imageUrl = safeImageUrl(wish.doneImage);
      if (imageUrl) {
        image.dataset.src = imageUrl;
        image.referrerPolicy = "no-referrer";
        card.classList.add("has-image", "image-loading");
        cardsWithImages.push(card);
      }

      placeCard(card, wish, index);
      initDrag(card, board);
      card.addEventListener("pointerdown", () => {
        card.style.zIndex = ++zCounter;
      });
      fragment.appendChild(card);
    });

    board.appendChild(fragment);
    filterCards();
    empty.style.display = wishes.length === 0 ? "flex" : "none";
    loadImagesAfterTextPaint(cardsWithImages);
  }

  function loadImagesAfterTextPaint(cards) {
    if (!cards.length) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if ("IntersectionObserver" in window) {
          let loadIndex = 0;
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }

              observer.unobserve(entry.target);
              scheduleImageLoad(entry.target, loadIndex);
              loadIndex += 1;
            });
          }, { rootMargin: "240px" });

          cards.forEach((card) => observer.observe(card));
          return;
        }

        cards.forEach(scheduleImageLoad);
      });
    });
  }

  function scheduleImageLoad(card, index) {
    window.setTimeout(() => loadCardImage(card), Math.min(index * 70, 1200));
  }

  function loadCardImage(card) {
    if (!card.isConnected) {
      return;
    }

    const image = card.querySelector(".wish-card-done-img");
    const imageUrl = image ? image.dataset.src : "";

    if (!imageUrl || image.dataset.loadingStarted) {
      return;
    }

    image.dataset.loadingStarted = "true";
    image.onload = () => {
      applyImageLayout(card, image);
      card.classList.remove("image-loading");
      card.classList.add("image-loaded");
      keepCardInsideBoard(card);
    };
    image.onerror = () => {
      card.classList.remove("image-loading");
      card.classList.add("image-error");
    };

    if ("fetchPriority" in image) {
      image.fetchPriority = "low";
    }

    image.src = imageUrl;
  }

  function applyImageLayout(card, image) {
    const width = image.naturalWidth || 16;
    const height = image.naturalHeight || 9;
    const ratio = width / height;

    card.style.setProperty("--wish-image-ratio", `${width} / ${height}`);
    card.classList.remove("image-landscape", "image-portrait", "image-square");

    if (ratio >= 1.2) {
      card.classList.add("image-landscape");
      return;
    }

    if (ratio <= 0.85) {
      card.classList.add("image-portrait");
      return;
    }

    card.classList.add("image-square");
  }

  function keepCardInsideBoard(card) {
    const board = document.getElementById("wishBoard");
    const margin = window.innerWidth < 768 ? 10 : 16;
    const maxLeft = Math.max(0, board.offsetWidth - card.offsetWidth - margin);
    const maxTop = Math.max(0, board.offsetHeight - card.offsetHeight - margin);

    card.style.left = `${clamp(card.offsetLeft, margin, maxLeft)}px`;
    card.style.top = `${clamp(card.offsetTop, margin, maxTop)}px`;
  }

  function placeCard(card, wish, index) {
    const board = document.getElementById("wishBoard");
    const boardRect = board.getBoundingClientRect();
    const mobile = window.innerWidth < 768;
    const cardW = mobile ? (window.innerWidth < 480 ? 124 : 150) : 230;
    const cardH = wish.doneImage ? (mobile ? 176 : 246) : (mobile ? 112 : 144);
    const margin = mobile ? 10 : 16;
    const position = wish.position || randomPosition(boardRect, cardW, cardH, margin);

    card.style.left = `${position.left}px`;
    card.style.top = `${position.top}px`;
    card.style.zIndex = wish.z || ++zCounter;
    card.style.transform = `rotate(${position.rotate.toFixed(2)}deg)`;
    card.style.animation = `wishCardIn 0.4s ease ${index * 35}ms forwards`;
  }

  function randomPosition(boardRect, cardW, cardH, margin) {
    const maxLeft = Math.max(boardRect.width - cardW - margin, margin);
    const maxTop = Math.max(boardRect.height - cardH - margin, margin);
    return {
      left: margin + Math.random() * (maxLeft - margin),
      top: margin + Math.random() * (maxTop - margin),
      rotate: Math.random() * 6 - 3
    };
  }

  function initDrag(card, board) {
    const header = card.querySelector(".wish-card-header");
    if (!header) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let pointerId = null;

    header.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      pointerId = event.pointerId;
      header.setPointerCapture(pointerId);
      card.classList.add("dragging");
      card.style.zIndex = ++zCounter;
      startX = event.clientX;
      startY = event.clientY;
      origX = card.offsetLeft;
      origY = card.offsetTop;
    });

    header.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || !card.classList.contains("dragging")) {
        return;
      }

      const boardW = board.offsetWidth;
      const boardH = board.offsetHeight;
      const cardW = card.offsetWidth;
      const cardH = card.offsetHeight;
      let nextLeft = origX + event.clientX - startX;
      let nextTop = origY + event.clientY - startY;

      nextLeft = clamp(nextLeft, 0, Math.max(0, boardW - cardW));
      nextTop = clamp(nextTop, 0, Math.max(0, boardH - cardH));
      card.style.left = `${nextLeft}px`;
      card.style.top = `${nextTop}px`;
    });

    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);

    function finishDrag(event) {
      if (pointerId !== event.pointerId) {
        return;
      }
      card.classList.remove("dragging");
      header.releasePointerCapture(pointerId);
      pointerId = null;
    }
  }

  function initTabs() {
    document.querySelectorAll(".wish-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".wish-tab").forEach((item) => item.classList.remove("active"));
        tab.classList.add("active");
        currentFilter = tab.dataset.filter;
        filterCards();
      });
    });
  }

  function filterCards() {
    const empty = document.getElementById("wishEmpty");
    let visible = 0;

    document.querySelectorAll(".wish-card").forEach((card, index) => {
      const show = currentFilter === "all" || card.dataset.type === currentFilter;
      card.style.display = show ? "" : "none";
      if (show) {
        visible += 1;
        card.style.animation = "none";
        card.style.opacity = "0";
        card.offsetWidth;
        card.style.animation = `wishCardIn 0.4s ease ${index * 20}ms forwards`;
      }
    });

    empty.style.display = visible === 0 ? "flex" : "none";
  }

  function initColorPicker() {
    document.querySelectorAll(".wish-color-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        document.querySelectorAll(".wish-color-dot").forEach((item) => item.classList.remove("active"));
        dot.classList.add("active");
        selectedColor = dot.dataset.color;
      });
    });
  }

  function initTypeToggle() {
    const button = document.getElementById("wishTypeToggle");
    button.addEventListener("click", () => {
      currentTypeIndex = (currentTypeIndex + 1) % types.length;
      button.textContent = types[currentTypeIndex].displayName;
    });
  }

  function initCharCounter() {
    const input = document.getElementById("wishContent");
    input.addEventListener("input", updateCharCounter);
    updateCharCounter();
  }

  function updateCharCounter() {
    const input = document.getElementById("wishContent");
    const counter = document.getElementById("wishCharCounter");
    counter.textContent = `${input.value.length}/${maxLen}`;
  }

  function initImageInput() {
    const toggle = document.getElementById("wishImageToggle");
    const imageInput = document.getElementById("wishImageUrl");

    toggle.addEventListener("change", () => {
      imageInput.hidden = !toggle.checked;
      if (toggle.checked) {
        imageInput.focus();
      } else {
        imageInput.value = "";
      }
    });
  }

  function initKeyboardLayout() {
    const inputBar = document.getElementById("wishInputBar");
    const focusable = inputBar.querySelectorAll("input, button");

    focusable.forEach((item) => {
      item.addEventListener("focus", () => {
        document.body.classList.add("input-focused");
        updateKeyboardOffset();
      });
      item.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (!inputBar.contains(document.activeElement)) {
            document.body.classList.remove("input-focused");
            document.documentElement.style.setProperty("--keyboard-offset", "0px");
          }
        }, 120);
      });
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateKeyboardOffset);
      window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
    }
  }

  function updateKeyboardOffset() {
    if (!window.visualViewport || !document.body.classList.contains("input-focused")) {
      return;
    }

    const viewport = window.visualViewport;
    const hiddenHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    const offset = window.innerWidth < 768 ? hiddenHeight : 0;
    document.documentElement.style.setProperty("--keyboard-offset", `${Math.round(offset)}px`);
  }

  function initSubmit() {
    const button = document.getElementById("wishSubmitBtn");
    const input = document.getElementById("wishContent");
    const closeButton = document.getElementById("captchaCloseBtn");

    button.addEventListener("click", () => submitWish());
    closeButton.addEventListener("click", hideCaptchaDialog);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitWish();
      }
    });
  }

  async function submitWish(captchaToken = "") {
    const button = document.getElementById("wishSubmitBtn");
    const contentInput = document.getElementById("wishContent");
    const nickInput = document.getElementById("wishNick");
    const imageToggle = document.getElementById("wishImageToggle");
    const imageInput = document.getElementById("wishImageUrl");
    const content = contentInput.value.trim();
    const doneImage = imageToggle.checked ? safeImageUrl(imageInput.value) : "";

    if (!content) {
      toast("写点什么吧");
      return;
    }

    if (imageToggle.checked && imageInput.value.trim() && !doneImage) {
      toast("图片地址需要是 https 链接");
      return;
    }

    if (securitySettings.captchaEnabled && !captchaToken) {
      showCaptchaDialog();
      return;
    }

    if (captchaSubmitting) {
      return;
    }

    captchaSubmitting = true;
    button.disabled = true;
    button.textContent = "提交中...";

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type: types[currentTypeIndex].slug,
          color: selectedColor,
          content,
          nickname: nickInput.value.trim() || "匿名",
          status: types[currentTypeIndex].slug === "wish" ? "doing" : "",
          doneImage,
          captchaToken
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "提交失败");
      }

      contentInput.value = "";
      imageToggle.checked = false;
      imageInput.value = "";
      imageInput.hidden = true;
      updateCharCounter();
      hideCaptchaDialog();
      toast("发布成功");
      await loadApprovedWishes();
    } catch (error) {
      console.error(error);
      resetCaptchaWidget();
      toast(error.message || "提交失败，请稍后再试");
    } finally {
      button.disabled = false;
      button.textContent = "发布";
      captchaSubmitting = false;
    }
  }

  async function showCaptchaDialog() {
    if (!securitySettings.captchaSiteKey) {
      toast("验证码未配置 Site Key");
      return;
    }

    const dialog = document.getElementById("captchaDialog");
    const hint = document.getElementById("captchaDialogHint");
    hint.textContent = securitySettings.captchaHelp || "为了防止刷屏，请先完成验证。";
    dialog.hidden = false;

    try {
      await loadHCaptcha();
      renderHCaptcha();
    } catch (error) {
      console.error(error);
      toast("验证码加载失败，请稍后再试");
    }
  }

  function hideCaptchaDialog() {
    const dialog = document.getElementById("captchaDialog");
    dialog.hidden = true;
    resetCaptchaWidget();
  }

  function resetCaptchaWidget() {
    if (window.hcaptcha && captchaWidgetId !== null) {
      window.hcaptcha.reset(captchaWidgetId);
    }
  }

  function loadHCaptcha() {
    if (window.hcaptcha) {
      return Promise.resolve();
    }

    if (captchaScriptLoading) {
      return captchaScriptLoading;
    }

    captchaScriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return captchaScriptLoading;
  }

  function renderHCaptcha() {
    const container = document.getElementById("captchaWidget");

    if (captchaWidgetId !== null) {
      window.hcaptcha.reset(captchaWidgetId);
      return;
    }

    captchaWidgetId = window.hcaptcha.render(container, {
      sitekey: securitySettings.captchaSiteKey,
      callback: (token) => {
        submitWish(token);
      },
      "expired-callback": () => {
        toast("验证码已过期，请重新验证");
      },
      "error-callback": () => {
        toast("验证码验证出错，请重试");
      }
    });
  }

  function typeLabel(slug) {
    const type = types.find((item) => item.slug === slug);
    return type ? type.displayName : slug;
  }

  function statusText(status) {
    if (status === "doing") {
      return "进行中";
    }
    if (status === "done") {
      return "已达成";
    }
    return "";
  }

  function formatDate(dateText) {
    const date = new Date(dateText);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function safeImageUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin || url.protocol === "https:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function toast(message) {
    const toastEl = document.getElementById("wishToast");
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastEl.timer);
    toastEl.timer = window.setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2200);
  }

  function seedWishes() {
    const now = Date.now();
    const rows = [
      ["我爱你💕～", "Love", "love", "pink", ""],
      ["我爱你💕～", "Love", "love", "green", "doing"],
      ["一定要出人头地啊 各位", "柠檬D-", "wish", "green", ""],
      ["音乐播放器！！！单独插件，非常需要！！！", "Beibing", "feedback", "green", ""],
      ["她好像确实不会来了，但明天还是要好好吃饭。", "夏天永远不会消失", "wish", "blue", ""],
      ["要勇敢一点，我们不会比今天更年轻了。", "RyanJenkins", "feedback", "blue", ""]
    ];

    return rows.map((row, index) => ({
      id: `demo-${index}`,
      content: row[0],
      nickname: row[1],
      type: row[2],
      color: row[3],
      status: row[4],
      createdAt: new Date(now - (index % 7) * 86400000).toISOString(),
      doneNote: "",
      doneImage: "",
      aiReply: "",
      position: null,
      z: 200 + index
    }));
  }
})();
