(function () {
  "use strict";

  const maxLen = 200;
  const apiUrl = "/api/wishes";
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

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    initTabs();
    initColorPicker();
    initTypeToggle();
    initCharCounter();
    initSubmit();
    await loadApprovedWishes();
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
        image.src = imageUrl;
        image.referrerPolicy = "no-referrer";
        card.classList.add("has-image");
      }

      board.appendChild(card);
      placeCard(card, wish, index);
      initDrag(card, board);
      card.addEventListener("pointerdown", () => {
        card.style.zIndex = ++zCounter;
      });
    });

    filterCards();
    empty.style.display = wishes.length === 0 ? "flex" : "none";
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

  function initSubmit() {
    const button = document.getElementById("wishSubmitBtn");
    const input = document.getElementById("wishContent");

    button.addEventListener("click", submitWish);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitWish();
      }
    });
  }

  async function submitWish() {
    const button = document.getElementById("wishSubmitBtn");
    const contentInput = document.getElementById("wishContent");
    const nickInput = document.getElementById("wishNick");
    const content = contentInput.value.trim();

    if (!content) {
      toast("写点什么吧");
      return;
    }

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
          status: types[currentTypeIndex].slug === "wish" ? "doing" : ""
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "提交失败");
      }

      contentInput.value = "";
      updateCharCounter();
      toast("发布成功");
      await loadApprovedWishes();
    } catch (error) {
      console.error(error);
      toast(error.message || "提交失败，请稍后再试");
    } finally {
      button.disabled = false;
      button.textContent = "发布";
    }
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
